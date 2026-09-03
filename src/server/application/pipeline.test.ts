import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ffmpegStatic from "ffmpeg-static";

// 强制演示数据，避免测试环境里的真实 API Key 触发网络调用。
vi.stubEnv("ASR_PROVIDER", "mock");
vi.stubEnv("ANALYSIS_PROVIDER", "mock");
const { analyzeMedia } = await import("./pipeline.js");

const tempDirs = [];
let videoPath;
let audioOnlyPath;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegStatic, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `ffmpeg 退出码 ${code}`));
    });
  });
}

beforeAll(async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "koma-pipeline-test-"));
  tempDirs.push(dir);
  videoPath = join(dir, "sample.mp4");
  audioOnlyPath = join(dir, "audio-only.mp3");
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath
  ]);
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-c:a", "libmp3lame", audioOnlyPath
  ]);
}, 30_000);

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("media analysis pipeline", () => {
  it("produces a timeline result and removes intermediate audio", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-pipeline-run-"));
    tempDirs.push(dir);
    const framesDir = join(dir, "frames");
    const audioDir = join(dir, "audio");
    const stages = [];

    const result = await analyzeMedia({
      inputPath: videoPath,
      title: "sample.mp4",
      framesDir,
      audioDir,
      onProgress: (progress) => stages.push(progress.stage)
    });

    expect(result.title).toBe("sample.mp4");
    expect(result.durationMs).toBeGreaterThan(3000);
    expect(result.durationMs).toBeLessThan(5000);
    expect(result.frames.length).toBeGreaterThanOrEqual(1);
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.transcript[0].text).toContain("演示");
    expect(stages).toEqual(expect.arrayContaining(["inspecting", "extracting_frames", "extracting_audio", "transcribing", "interpreting"]));

    const frameFiles = await readdir(framesDir);
    expect(frameFiles.filter((name) => name.endsWith(".jpg"))).toHaveLength(result.frames.length);
    await expect(stat(join(framesDir, result.frames[0].filename))).resolves.toBeTruthy();
    await expect(stat(audioDir)).rejects.toThrow();
  }, 30000);

  it("rejects files without a video stream with a friendly message", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-pipeline-run-"));
    tempDirs.push(dir);
    await expect(analyzeMedia({
      inputPath: audioOnlyPath,
      title: "audio-only.mp3",
      framesDir: join(dir, "frames"),
      audioDir: join(dir, "audio")
    })).rejects.toThrow("没有视频画面");
  });
});
