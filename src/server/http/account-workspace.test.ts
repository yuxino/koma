import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let child: ChildProcessWithoutNullStreams;
let root = "";
let baseUrl = "";
let output = "";
let database: DatabaseSync;
const tokenA = "a".repeat(43);
const tokenB = "b".repeat(43);
const viewerA = "v".repeat(43);
const viewerB = "w".repeat(43);
const cookieA = `koma_session=${tokenA}`;
const cookieB = `koma_session=${tokenB}`;
const own = "10000000-0000-4000-8000-000000000001";
const legacyA = "10000000-0000-4000-8000-000000000002";
const legacyB = "10000000-0000-4000-8000-000000000003";
const failed = "10000000-0000-4000-8000-000000000004";
const missingSource = "10000000-0000-4000-8000-000000000005";
const mutation = { "x-koma-client": "1" };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "koma-account-http-"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  baseUrl = `http://127.0.0.1:${address.port}`;
  child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
    env: { ...process.env, PORT: String(address.port), PUBLIC_BASE_URL: baseUrl, TEMP_ROOT: join(root, "tmp"), DB_DRIVER: "sqlite", KOMA_DATABASE_PATH: join(root, "koma.sqlite"), STORAGE_DRIVER: "local", LOCAL_STORAGE_PATH: join(root, "storage"), ASR_PROVIDER: "mock", VISION_PROVIDER: "mock", ANALYSIS_PROVIDER: "mock", DEMO_REQUESTS_PER_IP_PER_DAY: "0", ADMIN_PASSWORD: "test-admin", ANALYSIS_REQUIRE_ADMIN: "false", GITHUB_CLIENT_ID: "Iv1.test", GITHUB_CLIENT_SECRET: "test-only-secret", GITHUB_CALLBACK_URL: `${baseUrl}/api/auth/github/callback` },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  for (let n = 0; n < 150; n++) {
    try { if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) })).ok) break; } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  database = new DatabaseSync(join(root, "koma.sqlite"));
  for (const [id, token] of [["1", tokenA], ["2", tokenB]]) {
    database.prepare("INSERT INTO koma_accounts VALUES (?, ?, ?, ?, ?)").run(id, `user-${id}`, null, `https://avatars.githubusercontent.com/u/${id}`, Date.now());
    database.prepare("INSERT INTO koma_account_sessions VALUES (?, ?, ?)").run(hash(token), id, Date.now() + 3600000);
  }
  for (const id of [own, legacyA, legacyB, failed, missingSource]) await seedJob(id, [failed, missingSource].includes(id) ? "failed" : "done");
  for (const id of [own, failed, missingSource]) database.prepare("INSERT INTO koma_job_accounts VALUES (?, ?)").run(id, "1");
  database.prepare("INSERT INTO koma_job_owners VALUES (?, ?, ?)").run(legacyA, hash(viewerA), Date.now());
  database.prepare("INSERT INTO koma_job_owners VALUES (?, ?, ?)").run(legacyB, hash(viewerB), Date.now());
  database.prepare("UPDATE koma_jobs SET input_object_key = NULL, media_available = 0 WHERE id = ?").run(missingSource);
}, 20_000);

afterAll(async () => {
  database?.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  await rm(root, { recursive: true, force: true });
});

async function seedJob(id: string, status: string) {
  const prefix = `koma/jobs/${id}`;
  const result = { title: id === own ? "KOMA Workspace Check Verification" : "Private video", summary: "Private summary", durationMs: 1000, chapters: [], tags: [], transcript: [{ startMs: 0, endMs: 1000, text: "Private words" }], frames: [{ filename: "frame.jpg", atMs: 0, storageKey: `${prefix}/frames/frame.jpg` }], extractedData: { private: true }, artifacts: [{ id: "0", name: "report.json", format: "json", mimeType: "application/json", content: "", sizeBytes: 2, storageKey: `${prefix}/artifacts/report.json` }] };
  database.prepare("INSERT INTO koma_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, "upload", "koma-verification.mp4", status, status, 100, "Ready", "zh", JSON.stringify({ instruction: "Reuse me", artifactFormats: ["json"] }), status === "done" ? JSON.stringify(result) : null, "mock", "mock", "mock", "mock", Date.now(), Date.now(), status === "done" ? Date.now() : null, prefix, `${prefix}/video/source.mp4`, "video/mp4", 1, status === "failed" ? "Failed" : null);
  for (const [path, bytes] of [["video/source.mp4", "not-a-real-video"], ["frames/frame.jpg", "frame"], ["artifacts/report.json", "{}"]]) {
    const target = join(root, "storage", prefix, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function get(path: string, cookie?: string) { return fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" }); }
async function post(path: string, cookie: string, headers: Record<string, string> = mutation) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { cookie, ...headers } });
}

describe("account workspace HTTP boundaries", () => {
  it("returns only account history and never promotes a GitHub user to administrator", async () => {
    expect((await get("/api/my/jobs")).status).toBe(401);
    expect(await (await get("/api/my/jobs", cookieB)).json()).toEqual({ jobs: [] });
    const history = await (await get("/api/my/jobs", cookieA)).json() as { jobs: Array<Record<string, unknown>> };
    expect(history.jobs.map((job) => job.id).sort()).toEqual([own, failed, missingSource].sort());
    expect(history.jobs.find((job) => job.id === own)).toMatchObject({
      title: "KOMA Workspace Check Verification", sourceTitle: "koma-verification.mp4", summary: "Private summary", durationMs: 1000
    });
    expect(history.jobs.find((job) => job.id === failed)).toMatchObject({ title: "koma-verification.mp4", sourceTitle: "koma-verification.mp4" });
    expect(history.jobs.find((job) => job.id === failed)?.retryable).toBe(true);
    expect((await get("/api/admin/jobs", cookieA)).status).toBe(401);
    expect((await get("/api/admin/settings", cookieA)).status).toBe(401);
  });

  it.each(["", "/extraction", "/video", "/frames/frame.jpg", "/artifacts/0"])("gates every private resource %s and allows owner + admin", async (suffix) => {
    const anonymous = await get(`/api/jobs/${own}${suffix}`);
    expect(anonymous.status).toBe(404);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect((await get(`/api/jobs/${own}${suffix}`, cookieB)).status).toBe(404);
    const owner = await get(`/api/jobs/${own}${suffix}`, cookieA);
    expect(owner.status).toBe(200);
    expect(owner.headers.get("cache-control")).toContain("no-store");
    if (suffix === "/artifacts/0") expect(owner.headers.get("content-disposition")).toMatch(/^attachment; filename="report.json"/);
    else expect(owner.headers.get("content-disposition")).toBeNull();
    const login = await fetch(`${baseUrl}/api/admin/login`, { method: "POST", headers: { "x-koma-admin": "1", "content-type": "application/json" }, body: JSON.stringify({ password: "test-admin" }) });
    const adminCookie = login.headers.get("set-cookie")!.split(";", 1)[0];
    expect((await get(`/api/jobs/${own}${suffix}`, adminCookie)).status).toBe(200);
  });

  it("requires client header and same-origin requests for mutations", async () => {
    for (const path of ["/api/my/jobs/claim", `/api/my/jobs/${failed}/retry`, "/api/analyze/upload", "/api/analyze/url", "/api/analysis-spec/generate"]) {
      expect((await post(path, cookieA, {})).status).toBe(403);
      expect((await post(path, cookieA, { ...mutation, origin: "https://other.example" })).status).toBe(403);
      expect((await post(path, cookieA, { ...mutation, "sec-fetch-site": "cross-site" })).status).toBe(403);
    }
  });

  it("preserves old replay links and explicitly claims only this browser's tasks", async () => {
    expect((await get(`/api/jobs/${legacyA}`)).status).toBe(200);
    expect((await get(`/api/jobs/${legacyB}`)).status).toBe(200);
    expect(await (await get("/api/auth/session", `${cookieA}; koma_viewer=${viewerA}`)).json()).toMatchObject({ authenticated: true, legacyJobCount: 1 });
    expect(await (await post("/api/my/jobs/claim", cookieA)).json()).toEqual({ claimed: 0 });
    expect(await (await post("/api/my/jobs/claim", `${cookieA}; koma_viewer=${viewerA}`)).json()).toEqual({ claimed: 1 });
    expect((await get(`/api/jobs/${legacyA}`)).status).toBe(404);
    expect((await get(`/api/jobs/${legacyA}`, cookieB)).status).toBe(404);
    expect((await get(`/api/jobs/${legacyA}`, cookieA)).status).toBe(200);
    expect((await get(`/api/jobs/${legacyB}`)).status).toBe(200);
    expect(await (await post("/api/my/jobs/claim", `${cookieB}; koma_viewer=${viewerA}`)).json()).toEqual({ claimed: 0 });
  });

  it("retries an owned failed job from retained media without replacing its original", async () => {
    expect((await post(`/api/my/jobs/${failed}/retry`, cookieB)).status).toBe(404);
    expect((await post(`/api/my/jobs/${missingSource}/retry`, cookieA)).status).toBe(409);
    expect((await post(`/api/my/jobs/${own}/retry`, cookieA)).status).toBe(409);
    const response = await post(`/api/my/jobs/${failed}/retry`, cookieA);
    expect(response.status).toBe(202);
    const { jobId } = await response.json() as { jobId: string };
    expect(jobId).not.toBe(failed);
    expect((await get(`/api/jobs/${jobId}`)).status).toBe(404);
    const next = await (await get(`/api/jobs/${jobId}`, cookieA)).json() as { analysisSpec: unknown };
    expect(next.analysisSpec).toEqual({ instruction: "Reuse me", artifactFormats: ["json"] });
    expect((await get(`/api/jobs/${failed}`, cookieA)).status).toBe(200);
    for (let n = 0; n < 100; n++) {
      const state = await (await get(`/api/jobs/${jobId}`, cookieA)).json() as { status: string };
      if (["failed", "done"].includes(state.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  });

  it("deletion is owner-only and logging never records OAuth query values", async () => {
    const denied = await fetch(`${baseUrl}/api/my/jobs/${own}`, { method: "DELETE", headers: { ...mutation, cookie: cookieB } });
    expect(denied.status).toBe(404);
    const callback = await get("/api/auth/github/callback?code=DO_NOT_LOG_CODE&state=DO_NOT_LOG_STATE");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/?auth=expired");
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(output).not.toContain("DO_NOT_LOG_CODE");
    expect(output).not.toContain("DO_NOT_LOG_STATE");
  });

  it("retries a complete local source left by failed OSS storage without exposing it", async () => {
    const id = "10000000-0000-4000-8000-000000000006";
    await seedJob(id, "failed");
    database.prepare("INSERT INTO koma_job_accounts VALUES (?, ?)").run(id, "1");
    database.prepare("UPDATE koma_jobs SET input_object_key = NULL, media_available = 0 WHERE id = ?").run(id);
    const dir = join(root, "tmp", `koma-${id}`);
    const content = "complete locally retained source";
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, "input.mp4"), content, { mode: 0o600 });
    await writeFile(join(dir, "retry-source.json"), JSON.stringify({ filename: "input.mp4", size: Buffer.byteLength(content) }), { mode: 0o600 });
    expect((await post(`/api/my/jobs/${id}/retry`, cookieB)).status).toBe(404);
    const current = await (await get(`/api/jobs/${id}`, cookieA)).json() as { retryable: boolean };
    expect(current.retryable).toBe(true);
    expect(JSON.stringify(current)).not.toMatch(/retry-source|input\.mp4|localRetrySource/);
    const response = await post(`/api/my/jobs/${id}/retry`, cookieA);
    expect(response.status).toBe(202);
    const { jobId } = await response.json() as { jobId: string };
    expect((await get(`/api/jobs/${jobId}`, cookieB)).status).toBe(404);
    const target = join(root, "storage", "koma", "jobs", jobId, "video", "source.mp4");
    await expect.poll(async () => readFile(target, "utf8").catch(() => "")).toBe(content);
    expect((await fetch(`${baseUrl}/api/my/jobs/${id}`, { method: "DELETE", headers: { ...mutation, cookie: cookieA } })).status).toBe(204);
    await expect(stat(dir)).rejects.toThrow();
    await fetch(`${baseUrl}/api/my/jobs/${jobId}`, { method: "DELETE", headers: { ...mutation, cookie: cookieA } });
  });

  it("limits login starts before creating unbounded pending OAuth rows", async () => {
    let last: Response | undefined;
    for (let attempt = 0; attempt < 101; attempt++) last = await get("/api/auth/github");
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
    const row = database.prepare("SELECT COUNT(*) AS count FROM koma_oauth_attempts").get() as { count: number };
    expect(row.count).toBe(100);
  });

  it("logout revokes the server session and expires its browser cookie", async () => {
    const rejected = await fetch(`${baseUrl}/api/auth/session`, { method: "DELETE", headers: { cookie: cookieB } });
    expect(rejected.status).toBe(403);
    const result = await fetch(`${baseUrl}/api/auth/session`, { method: "DELETE", headers: { ...mutation, cookie: cookieB } });
    expect(result.status).toBe(204);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await (await get("/api/auth/session", cookieB)).json()).toMatchObject({ authenticated: false, user: null });
  });
});
