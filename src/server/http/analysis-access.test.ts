import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const jsonHeaders = { "content-type": "application/json" };
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
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      GITHUB_CALLBACK_URL: "",
      PUBLIC_BASE_URL: baseUrl,
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
  const database = new DatabaseSync(join(root, "koma.sqlite"));
  database.prepare("INSERT INTO koma_accounts VALUES (?, ?, ?, ?, ?)").run("1", "test-user", null, "https://avatars.githubusercontent.com/u/1", Date.now());
  database.prepare("INSERT INTO koma_account_sessions VALUES (?, ?, ?)").run(createHash("sha256").update("t".repeat(43)).digest("hex"), "1", Date.now() + 3600000);
  database.close();
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
  it.each(["/api/analysis-spec/generate", "/api/analyze/url", "/api/analyze/upload"])("requires GitHub identity for %s even with an admin session", async (path) => {
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST", headers: { ...jsonHeaders, "x-koma-admin": "1" }, body: JSON.stringify({ password: "test-admin-password" })
    });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0];
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST", headers: { ...jsonHeaders, "x-koma-client": "1", cookie }, body: JSON.stringify({})
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先使用 GitHub 登录，再继续操作。" });
  });

  it("retains the separate administrator restriction after GitHub sign-in", async () => {
    const accountCookie = `koma_session=${"t".repeat(43)}`;
    const headers = { ...jsonHeaders, "x-koma-client": "1", cookie: accountCookie };
    const denied = await fetch(`${baseUrl}/api/analyze/url`, { method: "POST", headers, body: "{}" });
    expect(denied.status).toBe(403);
    const login = await fetch(`${baseUrl}/api/admin/login`, {
      method: "POST", headers: { ...jsonHeaders, "x-koma-admin": "1" }, body: JSON.stringify({ password: "test-admin-password" })
    });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0];
    const allowed = await fetch(`${baseUrl}/api/analyze/url`, { method: "POST", headers: { ...headers, cookie: `${accountCookie}; ${adminCookie}` }, body: "{}" });
    expect(allowed.status).toBe(400);
  });

  it("rejects browser mutations without the client header before processing input", async () => {
    for (const path of ["/api/analysis-spec/generate", "/api/analyze/url", "/api/analyze/upload"]) {
      const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: jsonHeaders, body: "{}" });
      expect(response.status).toBe(403);
    }
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
