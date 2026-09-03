import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const jsonHeaders = { "content-type": "application/json" };
const analysisHeaders = { "x-koma-admin": "1" };
let child: ChildProcessWithoutNullStreams | undefined;
let root = "";
let baseUrl = "";
let serverOutput = "";

beforeAll(async () => {
  root = await mkdtemp(join(os.tmpdir(), "koma-analysis-access-test-"));
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
      ADMIN_PASSWORD: "test-admin-password",
      ANALYSIS_REQUIRE_ADMIN: "true"
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

describe("private analysis access", () => {
  it.each([
    ["AI JSON generation", "/api/analysis-spec/generate", jsonRequest({ instruction: "提取人物", additions: [], lang: "zh" }, true)],
    ["URL analysis", "/api/analyze/url", jsonRequest({ url: "not-a-url" }, true)],
    ["video upload", "/api/analyze/upload", { method: "POST", headers: analysisHeaders, body: new FormData() } satisfies RequestInit]
  ])("requires the existing admin session for %s", async (_label, path, init) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先登录管理后台，再开始生成或分析。" });
  });

  it("allows requests to reach normal validation after administrator sign-in", async () => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST",
      headers: { ...jsonHeaders, "x-koma-admin": "1" },
      body: JSON.stringify({ password: "test-admin-password" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^koma_admin=/);

    const missingHeaderChecks: Array<[string, RequestInit]> = [
      ["/api/analysis-spec/generate", {
        method: "POST",
        headers: { ...jsonHeaders, cookie: cookie! },
        body: JSON.stringify({ instruction: "提取人物", additions: [], lang: "zh" })
      }],
      ["/api/analyze/url", {
        method: "POST",
        headers: { ...jsonHeaders, cookie: cookie! },
        body: JSON.stringify({ url: "not-a-url" })
      }],
      ["/api/analyze/upload", {
        method: "POST",
        headers: { cookie: cookie! },
        body: new FormData()
      }]
    ];
    for (const [path, init] of missingHeaderChecks) {
      const response = await fetch(`${baseUrl}${path}`, init);
      expect(response.status, path).toBe(403);
    }

    const generation = await fetch(`${baseUrl}/api/analysis-spec/generate`, {
      method: "POST",
      headers: { ...jsonHeaders, ...analysisHeaders, cookie: cookie! },
      body: JSON.stringify({ instruction: "提取人物", additions: [], lang: "zh" })
    });
    expect(generation.status).toBe(503);

    const url = await fetch(`${baseUrl}/api/analyze/url`, {
      method: "POST",
      headers: { ...jsonHeaders, ...analysisHeaders, cookie: cookie! },
      body: JSON.stringify({ url: "not-a-url" })
    });
    expect(url.status).toBe(400);

    const uploadBody = new FormData();
    uploadBody.append("video", new Blob(["not a video"], { type: "text/plain" }), "not-video.txt");
    const upload = await fetch(`${baseUrl}/api/analyze/upload`, {
      method: "POST",
      headers: { ...analysisHeaders, cookie: cookie! },
      body: uploadBody
    });
    expect(upload.status).toBe(415);
  });
});

function jsonRequest(body: unknown, includeAnalysisHeader = false): RequestInit {
  return {
    method: "POST",
    headers: includeAnalysisHeader ? { ...jsonHeaders, ...analysisHeaders } : jsonHeaders,
    body: JSON.stringify(body)
  };
}

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
