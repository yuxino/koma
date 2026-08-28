import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import ffmpegStatic from "ffmpeg-static";
import { config } from "./config.js";

const require = createRequire(import.meta.url);
const ffprobeStatic = require("@ffprobe-installer/ffprobe") as { path: string };

const ffmpegBin: string = process.env.FFMPEG_PATH || (ffmpegStatic as unknown as string) || "ffmpeg";
const ffprobeBin: string = process.env.FFPROBE_PATH || ((ffprobeStatic as { path?: string } | null)?.path) || "ffprobe";

export interface MediaInfo {
  durationMs: number;
  hasVideo: boolean;
  hasAudio: boolean;
  hasNativeSubtitles: boolean;
}

// 下载前探测远程视频的时长，避免把整段视频拉下来才发现超长。
// 只请求视频开头的一段（faststart 视频的 moov 元数据在开头，通常几百 KB 内），
// 用 ffprobe 读本地临时文件拿时长；服务器不支持 Range、视频非 faststart 或
// 探测失败时返回 null，由调用方退回“完整下载后再检查”的兜底。
const PROBE_HEAD_BYTES = 4 * 1024 * 1024;

export async function probeRemoteVideoDuration(
  url: string,
  headers: Record<string, string>,
  options: { signal?: AbortSignal; timeoutMs?: number; tempRoot?: string } = {}
): Promise<number | null> {
  const { signal, timeoutMs = 15_000, tempRoot = config.tempRoot } = options;
  const probePath = join(tempRoot, `koma-probe-${randomUUID()}.mp4`);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { ...headers, range: `bytes=0-${PROBE_HEAD_BYTES - 1}`, "accept-encoding": "identity" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok || !response.body) return null;
    // 非视频响应（风控页、网页等）直接放弃探测
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html") || contentType.includes("text/plain")) return null;
    // 服务器可能忽略 Range 返回完整内容，也可能小文件一次给完：
    // 按 content-length（若存在）与探测上限的较小值读取，避免读空 body 抛错。
    const declaredLength = Number(response.headers.get("content-length") || 0);
    const readLimit = declaredLength > 0 ? Math.min(PROBE_HEAD_BYTES, declaredLength) : PROBE_HEAD_BYTES;
    const reader = response.body.getReader();
    let received = 0;
    const chunks: Buffer[] = [];
    try {
      while (received < readLimit) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = readLimit - received;
        const chunk = value.length > remaining ? value.subarray(0, remaining) : value;
        chunks.push(Buffer.from(chunk));
        received += chunk.length;
        if (chunk.length < value.length) break; // 到达探测上限，提前截断
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (received < 1024) return null;
    await mkdir(tempRoot, { recursive: true });
    await writeFile(probePath, Buffer.concat(chunks, received));
    const output = await runCommand(ffprobeBin, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      probePath
    ], signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000));
    const parsed = JSON.parse(output.stdout) as { format?: { duration?: string } };
    const seconds = Number.parseFloat(parsed.format?.duration || "0");
    return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
  } catch {
    // 探测失败（超时、网络错误等）交给下载后的完整检查
    return null;
  } finally {
    await rm(probePath, { force: true }).catch(() => undefined);
  }
}

export interface FrameInfo {
  filename: string;
  atMs: number;
}

export interface AudioSegment {
  filename: string;
  startMs: number;
  endMs: number;
  path: string;
}

export async function inspectVideo(inputPath: string, options: { signal?: AbortSignal } = {}): Promise<MediaInfo> {
  const output = await runCommand(ffprobeBin, ["-v", "error", "-show_format", "-show_streams", "-of", "json", inputPath], options.signal);
  const parsed = JSON.parse(output.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  const durationSeconds = Number.parseFloat(parsed.format?.duration || "0");
  if (durationSeconds > config.maxDurationSeconds) {
    throw new Error(`视频太长了，第一版最多支持 ${Math.round(config.maxDurationSeconds / 60)} 分钟。`);
  }
  return {
    durationMs: Math.round(durationSeconds * 1000),
    hasVideo: parsed.streams?.some((stream) => stream.codec_type === "video") || false,
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === "audio") || false,
    hasNativeSubtitles: parsed.streams?.some((stream) => stream.codec_type === "subtitle") || false
  };
}

export async function extractFullAudio(inputPath: string, outputPath: string, options: { signal?: AbortSignal } = {}): Promise<string> {
  await runCommand(ffmpegBin, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "128k",
    outputPath
  ], options.signal);
  return outputPath;
}

export async function extractFrames(inputPath: string, outputDir: string, options: { signal?: AbortSignal; durationMs?: number } = {}): Promise<FrameInfo[]> {
  await mkdir(outputDir, { recursive: true });

  // 先探明时长，决定均匀兜底帧的间隔，保证抽帧覆盖整个视频而不是只抽开头一段。
  const info = options.durationMs ? { durationMs: options.durationMs } : await inspectVideo(inputPath, options);
  const durationMs = Math.max(1, info.durationMs);

  // 第一步：场景检测抽“转场/重点”帧。画面变化超过阈值时保留，并让 ffmpeg
  // 通过 showinfo 把每帧的真实时间戳打到 stderr，我们再解析出来。
  const sceneFrames = await extractSceneFrames(inputPath, outputDir, options);

  // 第二步：如果重点帧不足，按时间均匀补足到 maxFrames，保证从头到尾都有画面。
  const frames = sceneFrames.length >= config.maxFrames
    ? sceneFrames.slice(0, config.maxFrames)
    : [...sceneFrames, ...await fillUniformFrames(inputPath, outputDir, durationMs, sceneFrames, options)];

  // 场景帧 + 均匀帧可能交错，统一按时间排序；文件名保留各自前缀，保证唯一即可。
  const ordered = [...frames].sort((a, b) => a.atMs - b.atMs);
  // 清理未选中的临时帧文件（scene/uniform 前缀但没进结果列表的），保持目录干净。
  const kept = new Set(ordered.map((frame) => frame.filename));
  for (const name of (await readdir(outputDir)).filter((n) => n.endsWith(".jpg") && !kept.has(n))) {
    await rm(join(outputDir, name), { force: true }).catch(() => undefined);
  }
  return ordered;
}

// 场景检测：select='gt(scene,THRESHOLD)' 只保留画面突变帧，showinfo 输出真实时间戳。
// showinfo 走 info 级日志，所以这里不能用 -loglevel error（会把时间戳过滤掉）。
async function extractSceneFrames(inputPath: string, outputDir: string, options: { signal?: AbortSignal }): Promise<FrameInfo[]> {
  try {
    await rm(join(outputDir, "scene-*.jpg"), { force: true }).catch(() => undefined);
    const output = await runCommand(ffmpegBin, [
      "-hide_banner", "-loglevel", "info", "-y", "-i", inputPath,
      "-vf", `select='gt(scene,${config.frameSceneThreshold})',scale=${config.frameWidth}:-2,showinfo`,
      "-vsync", "vfr", "-frames:v", String(config.maxFrames),
      join(outputDir, "scene-%03d.jpg")
    ], options.signal);
    // showinfo 输出形如 [Parsed_showinfo_3 @ ...] n: 12 pts: 24000 pts_time:0.96 ...
    const times = parseShowinfoTimes(output.stderr);
    const names = (await readdir(outputDir)).filter((name) => name.startsWith("scene-") && name.endsWith(".jpg")).sort();
    return names.map((filename, index) => ({
      filename,
      atMs: Math.max(0, Math.round((times[index] ?? 0) * 1000))
    }));
  } catch (error) {
    // 场景检测失败（如阈值过高没抽到帧）时返回空，由均匀补足接管
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (options.signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
    return [];
  }
}

// 均匀补足：在“场景帧之外”的时间点均匀抽帧，保证覆盖全程。
// fps=1/interval 会输出与期望间隔对应的帧，-frames:v 截断数量，不必再挑帧。
async function fillUniformFrames(inputPath: string, outputDir: string, durationMs: number, existing: FrameInfo[], options: { signal?: AbortSignal }): Promise<FrameInfo[]> {
  const remaining = Math.max(1, config.maxFrames - existing.length);
  // 期望间隔：希望 remaining 帧均匀铺满整段视频；短视频允许更密的采样
  const intervalSeconds = Math.max(0.1, (durationMs / 1000) / remaining);
  await rm(join(outputDir, "uniform-*.jpg"), { force: true }).catch(() => undefined);
  const output = await runCommand(ffmpegBin, [
    "-hide_banner", "-loglevel", "info", "-y", "-i", inputPath,
    "-vf", `fps=1/${intervalSeconds},scale=${config.frameWidth}:-2,showinfo`,
    "-frames:v", String(config.maxFrames),
    join(outputDir, "uniform-%03d.jpg")
  ], options.signal);
  const times = parseShowinfoTimes(output.stderr);
  const names = (await readdir(outputDir)).filter((name) => name.startsWith("uniform-") && name.endsWith(".jpg")).sort();
  // 与已有帧（场景帧）过于接近的时间点跳过，避免同一画面出现两次
  const existingBuckets = new Set(existing.map((frame) => Math.round(frame.atMs / 500) * 500));
  const added: FrameInfo[] = [];
  for (let index = 0; index < names.length && added.length < remaining; index += 1) {
    const atMs = Math.max(0, Math.round((times[index] ?? index * intervalSeconds) * 1000));
    if (existingBuckets.has(Math.round(atMs / 500) * 500)) continue;
    added.push({ filename: names[index], atMs });
  }
  return added;
}

// 从 ffmpeg showinfo 的 stderr 输出里解析每帧的 pts_time（单位秒）。
// 只认 showinfo 行，避免 info 级日志里其他 pts 字样被误收。
export function parseShowinfoTimes(stderr: string): number[] {
  const times: number[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.includes("showinfo")) continue;
    const match = line.match(/pts_time:(\d+(?:\.\d+)?)/);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) times.push(value);
    }
  }
  return times;
}

export async function extractAudioSegments(inputPath: string, outputDir: string, durationMs: number, options: { signal?: AbortSignal } = {}): Promise<AudioSegment[]> {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await runCommand(ffmpegBin, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-vn", "-map", "0:a:0", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "64k",
    "-f", "segment", "-segment_time", String(config.asrSegmentSeconds),
    "-reset_timestamps", "1", join(outputDir, "segment-%03d.mp3")
  ], options.signal);
  const names = (await readdir(outputDir)).filter((name) => name.endsWith(".mp3")).sort();
  return createAudioSegmentMetadata(names, durationMs, config.asrSegmentSeconds)
    .map((segment) => ({ ...segment, path: join(outputDir, segment.filename) }));
}

export function createAudioSegmentMetadata(names: string[], durationMs: number, segmentSeconds: number): Array<Omit<AudioSegment, "path">> {
  const segmentMs = segmentSeconds * 1000;
  return names.map((filename, index) => {
    const startMs = index * segmentMs;
    return {
      filename,
      startMs,
      endMs: Math.min(durationMs, startMs + segmentMs)
    };
  });
}

export function runCommand(command: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  if (signal?.aborted) return Promise.reject(new DOMException("分析已取消。", "AbortError"));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      child.kill("SIGKILL");
      reject(new DOMException("分析已取消。", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(`${command} 不可用：${error.message}`));
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error(stderr.trim() || `${command} 退出码 ${code}`));
    });
  });
}
