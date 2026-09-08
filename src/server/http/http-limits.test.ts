import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let child: ChildProcessWithoutNullStreams | undefined;
let root = "";
let baseUrl = "";
let serverOutput = "";
const uploadHeaders = { "x-koma-client": "1", cookie: `koma_session=${"t".repeat(43)}` };

beforeAll(async () => {
  root = await mkdtemp(join(os.tmpdir(), "koma-http-limits-test-"));
  await startTestServer();
  const database = new DatabaseSync(join(root, "koma.sqlite"));
  database.prepare("INSERT INTO koma_accounts VALUES (?, ?, ?, ?, ?)").run("1", "test-user", null, "https://avatars.githubusercontent.com/u/1", Date.now());
  database.prepare("INSERT INTO koma_account_sessions VALUES (?, ?, ?)").run(createHash("sha256").update("t".repeat(43)).digest("hex"), "1", Date.now() + 3600000);
  database.close();
}, 15_000);

async function startTestServer(dailyLimit = 0): Promise<void> {
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
      DEMO_REQUESTS_PER_IP_PER_DAY: String(dailyLimit),
      ADMIN_PASSWORD: "",
      MAX_UPLOAD_BYTES: String(96 * 1024)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth();
}

afterAll(async () => {
  await stopTestServer();
  if (root) await rm(root, { recursive: true, force: true });
}, 10_000);

async function stopTestServer(): Promise<void> {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    if (!await waitForExit(child, 2_000)) {
      child.kill("SIGKILL");
      await waitForExit(child, 2_000);
    }
  }
}

describe("HTTP body limits", () => {
  it("rejects oversized JSON before parsing it", async () => {
    const response = await fetch(`${baseUrl}/api/analyze/url`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-koma-client": "1", cookie: `koma_session=${"t".repeat(43)}` },
      body: JSON.stringify({ url: "https://example.com/video.mp4", padding: "x".repeat(70 * 1024) })
    });

    expect(response.status).toBe(413);
  });

  it("still streams multipart video uploads larger than the JSON limit", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(70 * 1024)], { type: "video/mp4" }), "upload.mp4");

    const response = await fetch(`${baseUrl}/api/analyze/upload`, { method: "POST", headers: { "x-koma-client": "1", cookie: `koma_session=${"t".repeat(43)}` }, body: form });
    expect(response.status).toBe(202);
    const body = await response.json() as { jobId?: string };
    expect(body.jobId).toMatch(/^[a-f0-9-]{36}$/);
    await waitForTerminalJob(body.jobId!);
  });

  it("reads analysis fields after the video part before starting a job", async () => {
    const form = videoForm();
    form.append("instruction", "Extract product names");
    form.append("outputSchema", '{"products":[]}');
    form.append("artifactFormats", "json");
    const response = await fetch(`${baseUrl}/api/analyze/upload`, { method: "POST", headers: uploadHeaders, body: form });
    expect(response.status).toBe(202);
    const { jobId } = await response.json() as { jobId: string };
    await waitForTerminalJob(jobId);
    const job = await (await fetch(`${baseUrl}/api/jobs/${jobId}`, { headers: uploadHeaders })).json();
    expect(job.analysisSpec).toEqual({ instruction: "Extract product names", outputSchema: { products: [] }, artifactFormats: ["json"] });
  });

  it("rejects invalid fields after the file and removes the provisional job", async () => {
    const form = videoForm();
    form.append("outputSchema", "invalid JSON");
    await expectRejectedUpload(form, 400);
  });

  it("rejects a second video part instead of accepting only the first", async () => {
    const form = videoForm();
    form.append("other", new Blob(["second video"], { type: "video/mp4" }), "second.mp4");
    await expectRejectedUpload(form, 413);
  });

  it("rejects empty video files without retaining them", async () => {
    await expectRejectedUpload(videoForm(0), 400);
  });

  it("rejects truncated uploads without leaving a job or partial input", async () => {
    await expectRejectedUpload(videoForm(100 * 1024), 413);
  });

  it("rejects a truncated text field even when its retained prefix is blank", async () => {
    const form = new FormData();
    form.append("instruction", `${" ".repeat(1024 * 1024)}discarded requirement`);
    form.append("file", new Blob(["video"], { type: "video/mp4" }), "upload.mp4");
    await expectRejectedUpload(form, 413);
  });

  it("rejects duplicate analysis fields rather than silently choosing one", async () => {
    const form = videoForm();
    form.append("instruction", "First");
    form.append("instruction", "Second");
    await expectRejectedUpload(form, 400);
  });

  it("rejects an incomplete trailing field after the video was fully received", async () => {
    const response = await uploadWithDelayedTail({ complete: false });
    if (response.status === 202) {
      await waitForTerminalJob(response.jobId!);
      await fetch(`${baseUrl}/api/my/jobs/${response.jobId}`, { method: "DELETE", headers: uploadHeaders });
    }
    expect(response.status).toBe(400);
  });

  it("accepts a complete trailing field when the closing delimiter spans network writes", async () => {
    const response = await uploadWithDelayedTail({ complete: true });
    expect(response.status).toBe(202);
    await waitForTerminalJob(response.jobId!);
    const job = await (await fetch(`${baseUrl}/api/jobs/${response.jobId}`, { headers: uploadHeaders })).json();
    expect(job.analysisSpec).toEqual({ instruction: "Read this requirement" });
  });

  it.each(["disconnect", "delete"])("cleans an upload interrupted by %s before analysis can start", async (action) => {
    const database = new DatabaseSync(join(root, "koma.sqlite"));
    const filename = `interrupted-${action}.mp4`;
    const boundary = "koma-test-boundary";
    const uploading = httpRequest(`${baseUrl}/api/analyze/upload`, {
      method: "POST", headers: { ...uploadHeaders, "content-type": `multipart/form-data; boundary=${boundary}` }
    });
    const response = new Promise<number | string>((resolve) => {
      uploading.once("response", (reply) => { reply.resume(); resolve(reply.statusCode!); });
      uploading.once("error", (error) => resolve(error.message));
    });
    const findJob = () => database.prepare("SELECT id FROM koma_jobs WHERE title = ?").get(filename) as { id: string } | undefined;
    try {
      uploading.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`);
      uploading.write(Buffer.alloc(32 * 1024));
      await expect.poll(findJob).toBeDefined();
      const { id } = findJob()!;
      if (action === "delete") {
        const deleted = await fetch(`${baseUrl}/api/my/jobs/${id}`, { method: "DELETE", headers: uploadHeaders });
        expect(deleted.status).toBe(204);
        uploading.end(`\r\n--${boundary}--\r\n`);
        expect(await response).not.toBe(202);
      } else uploading.destroy();
      await expect.poll(findJob).toBeUndefined();
      await expect.poll(async () => stat(join(root, "tmp", `koma-${id}`)).then(() => true, () => false)).toBe(false);
      expect((await fetch(`${baseUrl}/api/jobs/${id}`, { headers: uploadHeaders })).status).toBe(404);
    } finally {
      uploading.destroy();
      database.close();
    }
  });

  it("rejects exhausted allowance before reading the video or creating a provisional job", async () => {
    await stopTestServer();
    await startTestServer(1);
    const invalid = videoForm();
    invalid.append("outputSchema", "invalid JSON");
    await expectRejectedUpload(invalid, 400);
    expect((await uploadWithDelayedTail({ complete: true, deleteBeforeEnd: true })).status).toBe(400);
    const accepted = await fetch(`${baseUrl}/api/analyze/upload`, { method: "POST", headers: uploadHeaders, body: videoForm() });
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("x-ratelimit-remaining")).toBe("0");
    const { jobId } = await accepted.json() as { jobId: string };
    await waitForTerminalJob(jobId);
    const database = new DatabaseSync(join(root, "koma.sqlite"));
    database.exec("CREATE TABLE upload_insert_audit (id TEXT); CREATE TRIGGER audit_upload_insert AFTER INSERT ON koma_jobs BEGIN INSERT INTO upload_insert_audit VALUES (NEW.id); END");
    const boundary = "over-limit-upload";
    const uploading = httpRequest(`${baseUrl}/api/analyze/upload`, {
      method: "POST", headers: { ...uploadHeaders, "content-type": `multipart/form-data; boundary=${boundary}` }
    });
    let responseStatus: number | undefined;
    uploading.on("error", () => {});
    uploading.once("response", (response) => { responseStatus = response.statusCode; response.resume(); });
    const directories = await readdir(join(root, "tmp"));
    try {
      uploading.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="over-limit.mp4"\r\nContent-Type: video/mp4\r\n\r\n`);
      uploading.write(Buffer.alloc(32 * 1024));
      // Keep the body open: rejection must not wait for the rest of a potentially large upload.
      await expect.poll(() => responseStatus).toBe(429);
      expect(database.prepare("SELECT COUNT(*) AS count FROM upload_insert_audit").get()?.count).toBe(0);
      expect(await readdir(join(root, "tmp"))).toEqual(directories);
    } finally {
      uploading.destroy();
      database.exec("DROP TRIGGER audit_upload_insert; DROP TABLE upload_insert_audit");
      database.close();
    }
  });
});

async function uploadWithDelayedTail({ complete, deleteBeforeEnd = false }: { complete: boolean; deleteBeforeEnd?: boolean }): Promise<{ status: number; jobId?: string }> {
  const database = new DatabaseSync(join(root, "koma.sqlite"));
  const filename = `tail-${complete}-${deleteBeforeEnd}.mp4`;
  const boundary = "koma-tail-boundary";
  const uploading = httpRequest(`${baseUrl}/api/analyze/upload`, {
    method: "POST", headers: { ...uploadHeaders, "content-type": `multipart/form-data; boundary="${boundary}"` }
  });
  const response = new Promise<{ status: number; jobId?: string }>((resolve, reject) => {
    uploading.once("response", (reply) => {
      let body = "";
      reply.on("data", (chunk) => { body += chunk; });
      reply.once("end", () => resolve({ status: reply.statusCode!, ...JSON.parse(body) }));
    });
    uploading.once("error", reject);
  });
  void response.catch(() => {});
  const findJob = () => database.prepare("SELECT id FROM koma_jobs WHERE title = ?").get(filename) as { id: string } | undefined;
  try {
    uploading.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`);
    uploading.write(Buffer.alloc(32 * 1024));
    uploading.write(`\r\n--${boundary}\r\n`);
    await expect.poll(findJob).toBeDefined();
    const { id } = findJob()!;
    await expect.poll(async () => stat(join(root, "tmp", `koma-${id}`, "input.mp4")).then((info) => info.size, () => 0)).toBe(32 * 1024);
    if (deleteBeforeEnd) {
      expect((await fetch(`${baseUrl}/api/my/jobs/${id}`, { method: "DELETE", headers: uploadHeaders })).status).toBe(204);
    }
    uploading.write("Content-Disposition: form-data; name=\"instruction\"\r\n\r\nRead this requirement");
    if (complete) {
      uploading.write(`\r\n--${boundary.slice(0, 5)}`);
      await delay(20);
      uploading.end(`${boundary.slice(5)}--\r\n`);
    } else uploading.end();
    const result = await response;
    if (result.status !== 202) {
      expect(findJob()).toBeUndefined();
      await expect(stat(join(root, "tmp", `koma-${id}`))).rejects.toThrow();
    }
    return result;
  } finally {
    uploading.destroy();
    database.close();
  }
}

function videoForm(size = 70 * 1024): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(size)], { type: "video/mp4" }), "upload.mp4");
  return form;
}

async function expectRejectedUpload(form: FormData, status: number): Promise<void> {
  const database = new DatabaseSync(join(root, "koma.sqlite"));
  const count = () => database.prepare("SELECT COUNT(*) AS count FROM koma_jobs").get()?.count;
  const before = count();
  const directories = await readdir(join(root, "tmp")).catch(() => []);
  try {
    const response = await fetch(`${baseUrl}/api/analyze/upload`, { method: "POST", headers: uploadHeaders, body: form, signal: AbortSignal.timeout(3000) });
    if (response.status === 202) {
      const { jobId } = await response.json() as { jobId: string };
      await waitForTerminalJob(jobId);
      await fetch(`${baseUrl}/api/my/jobs/${jobId}`, { method: "DELETE", headers: uploadHeaders });
    }
    expect(response.status).toBe(status);
    expect(count()).toBe(before);
    expect(await readdir(join(root, "tmp")).catch(() => [])).toEqual(directories);
  } finally {
    database.close();
  }
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

async function waitForTerminalJob(jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`, { headers: { cookie: `koma_session=${"t".repeat(43)}` } });
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
