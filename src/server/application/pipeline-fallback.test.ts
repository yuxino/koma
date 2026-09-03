import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ffmpegStatic from "ffmpeg-static";

// 强制真实 provider + 说话人分离，并 mock 掉两个 ASR 入口，验证失败降级。
vi.stubEnv("ASR_PROVIDER", "dashscope");
vi.stubEnv("DASHSCOPE_API_KEY", "test-key");
vi.stubEnv("PUBLIC_BASE_URL", "https://example.com");
vi.stubEnv("ANALYSIS_PROVIDER", "mock");

// transcribeFullAudio 抛错（模拟公网地址不可达等），transcribe 正常返回
vi.mock("../media/asr.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../media/asr.js")>();
  return {
    ...actual,
    transcribeFullAudio: vi.fn().mockRejectedValue(new Error("听写任务失败：音频无法下载")),
    transcribe: vi.fn().mockResolvedValue([{ startMs: 0, endMs: 1000, text: "降级后的听写" }])
  };
});

const { analyzeMedia } = await import("./pipeline.js");

const tempDirs: string[] = [];
let videoPath = "";

function runFfmpeg(args: string[]): Promise<void> {
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
  const dir = await mkdtemp(join(os.tmpdir(), "koma-fallback-test-"));
  tempDirs.push(dir);
  videoPath = join(dir, "sample.mp4");
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", videoPath
  ]);
}, 30_000);

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("speaker diarization fallback", () => {
  it("falls back to segment transcription when diarization fails, instead of failing the whole analysis", async () => {
    const dir = await mkdtemp(join(os.tmpdir(), "koma-fallback-run-"));
    tempDirs.push(dir);
    const { transcribe, transcribeFullAudio } = await import("../media/asr.js");

    const result = await analyzeMedia({
      inputPath: videoPath,
      title: "sample.mp4",
      framesDir: join(dir, "frames"),
      audioDir: join(dir, "audio")
    });

    expect(transcribeFullAudio).toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalled();
    // 降级后仍有听写和结果，分析没有整体失败
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.transcript[0].text).toContain("降级后的听写");
    expect(result.summary.length).toBeGreaterThan(0);
  });
});
