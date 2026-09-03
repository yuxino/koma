import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let child: ChildProcessWithoutNullStreams | undefined;
let root = "";
let baseUrl = "";
let serverOutput = "";

beforeAll(async () => {
  root = await mkdtemp(join(os.tmpdir(), "koma-http-limits-test-"));
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      TEMP_ROOT: join(root, "tmp"),
      DB_DRIVER: "sqlite",
      KOMA_DATABASE_PATH: join(root, "koma.sqlite"),
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_PATH: join(root, "storage"),
      ASR_PROVIDER: "mock",
      VISION_PROVIDER: "mock",
      ANALYSIS_PROVIDER: "mock",
      DEMO_REQUESTS_PER_IP_PER_DAY: "0",
      ADMIN_PASSWORD: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
}, 15_000);

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    if (!await waitForExit(child, 2_000)) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  }
  if (root) await rm(root, { recursive: true, force: true });
}, 10_000);

describe("HTTP body limits", () => {
  it("rejects oversized JSON before parsing it", async () => {
    const response = await fetch(`${baseUrl}/api/analyze/url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/video.mp4", padding: "x".repeat(70 * 1024) })
    });

    expect(response.status).toBe(413);
  });

  it("still streams multipart video uploads larger than the JSON limit", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(70 * 1024)], { type: "video/mp4" }), "upload.mp4");

    const response = await fetch(`${baseUrl}/api/analyze/upload`, { method: "POST", body: form });
    expect(response.status).toBe(202);
    const body = await response.json() as { jobId?: string };
    expect(body.jobId).toMatch(/^[a-f0-9-]{36}$/);
    await waitForTerminalJob(body.jobId!);
  });
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("没有拿到测试端口。");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Koma 测试服务提前退出。\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // 服务仍在启动。
    }
    await delay(50);
  }
  throw new Error(`Koma 测试服务启动超时。\n${serverOutput}`);
}

async function waitForTerminalJob(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    const body = await response.json() as { status?: string };
    if (body.status === "done" || body.status === "failed") return;
    await delay(50);
  }
  throw new Error("上传测试任务没有及时结束。");
}

function waitForExit(process: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    process.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
