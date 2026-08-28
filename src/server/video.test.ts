import { createReadStream, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ffmpegStatic from "ffmpeg-static";
import { createAudioSegmentMetadata, parseShowinfoTimes, probeRemoteVideoDuration, runCommand } from "./video.js";

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
  // faststart 让 moov 在文件开头，远程探测只需要 Range 拉元数据
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
});

describe("remote duration probe", () => {
  // 本地服务器：支持 Range 请求，并记录每次请求实际传输的字节数
  function startVideoServer(filePath: string): Promise<{ port: number; transferred: () => number; close: () => void }> {
    const size = statSync(filePath).size;
    let transferredBytes = 0;
    const server = createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        const start = Number(match?.[1] || 0);
        // 越界 Range 按真实 CDN 行为 clamp 到文件末尾
        const end = Math.min(match?.[2] ? Number(match[2]) : size - 1, size - 1);
        res.writeHead(206, {
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": end - start + 1,
          "content-type": "video/mp4"
        });
        const stream = createReadStream(filePath, { start, end });
        stream.on("data", (chunk) => { transferredBytes += chunk.length; });
        stream.pipe(res);
      } else {
        res.writeHead(200, { "content-length": size, "content-type": "video/mp4" });
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => { transferredBytes += chunk.length; });
        stream.pipe(res);
      }
    });
    return new Promise((resolve) => {
      server.listen(0, () => {
        const address = server.address() as { port: number };
        resolve({
          port: address.port,
          transferred: () => transferredBytes,
          close: () => server.close()
        });
      });
    });
  }

  it("reads the duration from the head bytes over Range without downloading the whole file", async () => {
    const server = await startVideoServer(probeVideoPath);
    const probeRoot = join(tempDirs[0], "missing-probe-root");
    try {
      const durationMs = await probeRemoteVideoDuration(`http://127.0.0.1:${server.port}/probe.mp4`, {}, { tempRoot: probeRoot });
      // 3 秒视频：允许 ±500ms 的容器时间戳误差
      expect(durationMs).toBeGreaterThan(2500);
      expect(durationMs).toBeLessThan(3500);
      expect(statSync(probeRoot).isDirectory()).toBe(true);
      // 视频本身只有几十 KB，探测应该只拉了头部（远小于 4MB 上限即视为通过）
      expect(server.transferred()).toBeLessThan(1024 * 1024);
    } finally {
      server.close();
    }
  });

  it("returns null when the server is unreachable", async () => {
    const durationMs = await probeRemoteVideoDuration("http://127.0.0.1:1/unreachable.mp4", {}, { timeoutMs: 3000 });
    expect(durationMs).toBeNull();
  });

  it("returns null for a non-video response", async () => {
    const server = createServer((_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.end("not a video");
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address() as { port: number };
      const durationMs = await probeRemoteVideoDuration(`http://127.0.0.1:${address.port}/x`, {});
      expect(durationMs).toBeNull();
    } finally {
      server.close();
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
