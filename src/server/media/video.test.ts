import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import ffmpegStatic from "ffmpeg-static";
import { createAudioSegmentMetadata, extractFrames, parseShowinfoTimes, inspectVideo, runCommand } from "./video.js";

const tempDirs: string[] = [];
let probeVideoPath = "";

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
  const dir = await mkdtemp(join(os.tmpdir(), "koma-video-test-"));
  tempDirs.push(dir);
  probeVideoPath = join(dir, "probe.mp4");
  // A real local MP4 fixture, inspected without a remote pre-probe.
  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", probeVideoPath
  ]);
}, 30_000);

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("command runner", () => {
  it("returns stdout from a successful process", async () => {
    const result = await runCommand(process.execPath, ["-e", "process.stdout.write('ready')"]);
    expect(result.stdout).toBe("ready");
  });

  it("surfaces a useful failure message", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.stderr.write('broken'); process.exit(2)"])).rejects.toThrow("broken");
  });

  it("aborts a running process when the signal fires", async () => {
    const controller = new AbortController();
    const run = runCommand(process.execPath, ["-e", "setTimeout(() => process.exit(0), 30_000)"], controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  }, 10_000);

  it("does not spawn a process for an already-aborted signal", async () => {
    const marker = join(tempDirs[0], "pre-aborted-command-ran");
    const controller = new AbortController();
    controller.abort();

    await expect(runCommand(process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`], controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(existsSync(marker)).toBe(false);
  });

  it("does not enter uniform-frame fallback after scene extraction is aborted", async () => {
    const outputDir = join(tempDirs[0], "aborted-frames");
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return true;
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as AbortSignal;

    await expect(extractFrames("unused.mp4", outputDir, { durationMs: 1_000, signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(abortedReads).toBe(1);
  });
});

describe("local video inspection", () => {
  it("reads a real MP4 without making remote requests", async () => {
    const remote = vi.fn();
    vi.stubGlobal("fetch", remote);
    try {
      const media = await inspectVideo(probeVideoPath);
      expect(media.hasVideo).toBe(true);
      expect(media.durationMs).toBeGreaterThan(2500);
      expect(media.durationMs).toBeLessThan(3500);
      expect(remote).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("audio segment timeline", () => {
  it("caps the last segment at the video duration", () => {
    expect(createAudioSegmentMetadata(
      ["segment-000.mp3", "segment-001.mp3", "segment-002.mp3"],
      125000,
      60
    )).toEqual([
      { filename: "segment-000.mp3", startMs: 0, endMs: 60000 },
      { filename: "segment-001.mp3", startMs: 60000, endMs: 120000 },
      { filename: "segment-002.mp3", startMs: 120000, endMs: 125000 }
    ]);
  });
});

describe("parseShowinfoTimes", () => {
  it("extracts pts_time from showinfo lines in order", () => {
    const stderr = [
      "[Parsed_showinfo_1 @ 0x0] config in time_base: 1/10240",
      "[Parsed_showinfo_1 @ 0x0] n:   0 pts: 2048 pts_time:0.2       duration:0.1",
      "[Parsed_showinfo_1 @ 0x0] n:   1 pts: 4096 pts_time:0.4       duration:0.1",
      "[Parsed_showinfo_1 @ 0x0] n:   2 pts: 6144 pts_time:0.6       duration:0.1"
    ].join("\n");
    expect(parseShowinfoTimes(stderr)).toEqual([0.2, 0.4, 0.6]);
  });

  it("ignores non-showinfo log lines", () => {
    const stderr = [
      "[info] frame=  100 fps= 30 q=28.0 size= 100kB time=00:00:03.33",
      "[Parsed_showinfo_1 @ 0x0] n:   0 pts: 1024 pts_time:0.1       duration:0.1"
    ].join("\n");
    expect(parseShowinfoTimes(stderr)).toEqual([0.1]);
  });

  it("returns an empty array when there are no showinfo lines", () => {
    expect(parseShowinfoTimes("")).toEqual([]);
    expect(parseShowinfoTimes("nothing here")).toEqual([]);
  });
});
