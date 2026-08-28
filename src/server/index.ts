import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isIP } from "node:net";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { createJob, deleteJob, loadJob, serializeJob, updateJob, type Job } from "./jobs.js";
import { getTempAudio } from "./temp-audio.js";
import { enqueueAnalysis } from "./pipeline.js";
import { streamToFile } from "./download.js";
import { extractUrlFromText } from "./resolver.js";
import { normalizeVideoUrl } from "./url-source.js";
import { parseByteRange } from "./video-stream.js";
import { createDailyLimiter } from "./rate-limit.js";
import { ARTIFACT_FORMATS, parseAnalysisSpec } from "./analysis-spec.js";
import { generateAnalysisSpec, validateAnalysisSpecGenerationLanguage, validateAnalysisSpecGenerationRequest } from "./analysis-spec-ai.js";
import { contentDisposition } from "./artifacts.js";
import {
  adminAuthEnabled,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSession,
  isAdminSession,
  revokeAdminSession
} from "./admin-auth.js";
import { databaseDriver, initializeDatabase, listJobHistory, listOwnedJobHistory, markInterruptedJobs, type JobHistoryRecord } from "./database.js";
import { getRuntimeProviders, getSafeProviderSettings, initializeProviderSettings, resetProviderSettings, updateProviderSettings } from "./provider-runtime.js";
import { initializeStorage, storageHealth, storedObjectInfo } from "./storage.js";
import { readViewerOwnerId, resolveViewerIdentity, viewerSessionCookie } from "./viewer-session.js";

await initializeDatabase();
await markInterruptedJobs();
await initializeStorage();
await initializeProviderSettings();

const app = Fastify({ logger: true, bodyLimit: config.maxUploadBytes + 1024 * 1024, trustProxy: config.trustProxy });
const demoLimiter = createDailyLimiter(config.demoRequestsPerIpPerDay);
await app.register(multipart, { limits: { files: 1, fileSize: config.maxUploadBytes } });

app.get("/api/health", async () => {
  const providers = getRuntimeProviders();
  const asrConfigured = providers.asr.provider !== "mock" && Boolean(providers.asr.apiKey);
  const visionConfigured = providers.vision.provider !== "mock" && Boolean(providers.vision.apiKey);
  return {
    ok: true,
    service: "koma",
    providers: { asr: providers.asr.provider, vision: providers.vision.provider },
    asrProvider: providers.asr.provider,
    analysisProvider: providers.vision.provider,
    models: { asr: providers.asr.model || null, vision: providers.vision.model || null },
    limits: { maxUploadBytes: config.maxUploadBytes, maxDurationSeconds: config.maxDurationSeconds },
    features: { customExtraction: true, analysisSpecGeneration: true, rawExtractionEndpoint: true, downloadableArtifacts: true, permanentReplay: true, viewerHistory: true, viewerOwnedDeletion: true, artifactFormats: ARTIFACT_FORMATS, admin: adminAuthEnabled() },
    configured: { asr: asrConfigured, vision: visionConfigured, analysis: visionConfigured },
    database: { driver: databaseDriver() },
    storage: storageHealth(),
    demoLimitPerIpPerDay: config.demoRequestsPerIpPerDay || null,
    mock: { asr: providers.asr.provider === "mock", vision: providers.vision.provider === "mock", analysis: providers.vision.provider === "mock" }
  };
});

app.post("/api/analysis-spec/generate", { bodyLimit: 16 * 1024 }, async (request, reply) => {
  reply.header("cache-control", "no-store");
  let instruction: string;
  let additions: string[];
  let language: "en" | "zh" | undefined;
  try {
    const body = request.body as { instruction?: unknown; additions?: unknown; lang?: unknown } | undefined;
    ({ instruction, additions } = validateAnalysisSpecGenerationRequest(body?.instruction, body?.additions));
    language = validateAnalysisSpecGenerationLanguage(body?.lang);
  } catch (error) {
    return reply.code(400).send({ error: messageOf(error) });
  }
  // Invalid input must not consume the same public demo allowance used by analysis jobs.
  if (!acceptDemoRequest(request, reply)) return;
  const controller = new AbortController();
  const abortGeneration = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!reply.raw.writableEnded) abortGeneration();
  };
  request.raw.once("aborted", abortGeneration);
  reply.raw.once("close", abortOnClosedResponse);
  try {
    return reply.send(await generateAnalysisSpec({ instruction, additions, language, signal: controller.signal }));
  } catch (error) {
    if (controller.signal.aborted) return;
    return reply.code(statusCodeOf(error) || 502).send({ error: messageOf(error) });
  } finally {
    request.raw.off("aborted", abortGeneration);
    reply.raw.off("close", abortOnClosedResponse);
  }
});

app.get("/api/admin/session", async (request, reply) => {
  return reply.header("cache-control", "no-store").send({ enabled: adminAuthEnabled(), authenticated: adminAuthEnabled() && isAdminSession(request.headers.cookie) });
});

app.post("/api/admin/login", async (request, reply) => {
  if (!adminMutationHeader(request)) return reply.code(403).send({ error: "管理请求校验失败。" });
  if (!adminAuthEnabled()) return reply.code(503).send({ error: "管理后台尚未启用，请先配置 ADMIN_PASSWORD。" });
  try {
    const token = createAdminSession((request.body as { password?: unknown } | undefined)?.password, request.ip);
    if (!token) return reply.code(401).send({ error: "管理员密码不正确。" });
    return reply.header("set-cookie", adminSessionCookie(token, request.protocol === "https")).header("cache-control", "no-store").send({ authenticated: true });
  } catch (error) {
    return reply.code(429).send({ error: messageOf(error) });
  }
});

app.delete("/api/admin/session", async (request, reply) => {
  if (!adminMutationHeader(request)) return reply.code(403).send({ error: "管理请求校验失败。" });
  revokeAdminSession(request.headers.cookie);
  return reply.header("set-cookie", clearAdminSessionCookie(request.protocol === "https")).code(204).send();
});

app.get("/api/admin/settings", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return reply.header("cache-control", "no-store").send(getSafeProviderSettings());
});

app.put("/api/admin/settings", async (request, reply) => {
  if (!requireAdminMutation(request, reply)) return;
  try {
    return reply.header("cache-control", "no-store").send(await updateProviderSettings(request.body as Parameters<typeof updateProviderSettings>[0]));
  } catch (error) {
    return reply.code(400).send({ error: messageOf(error) });
  }
});

app.post("/api/admin/settings/reset", async (request, reply) => {
  if (!requireAdminMutation(request, reply)) return;
  try {
    return reply.header("cache-control", "no-store").send(await resetProviderSettings());
  } catch (error) {
    return reply.code(400).send({ error: messageOf(error) });
  }
});

app.get("/api/admin/jobs", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return reply.header("cache-control", "no-store").send({ jobs: await listJobHistory(200) });
});

app.get("/api/admin/jobs/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  if (!requireAdmin(request, reply)) return;
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  return reply.header("cache-control", "no-store").send(serializeJob(job));
});

app.delete("/api/admin/jobs/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  if (!requireAdminMutation(request, reply)) return;
  await deleteJob(request.params.id);
  return reply.code(204).send();
});

app.get("/api/my/jobs", async (request, reply) => {
  const ownerId = ensureViewerIdentity(request, reply);
  const jobs = (await listOwnedJobHistory(ownerId, 100)).map(publicHistoryRecord);
  return reply.header("cache-control", "no-store").send({ jobs });
});

app.delete("/api/my/jobs/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  if (!viewerMutationHeader(request)) return reply.code(403).send({ error: "用户请求校验失败。" });
  const ownerId = readViewerOwnerId(request.headers.cookie);
  if (!ownerId) return reply.code(404).send({ error: "找不到这次分析。" });
  const job = await loadJob(request.params.id);
  if (!job || job.ownerId !== ownerId) return reply.code(404).send({ error: "找不到这次分析。" });
  await deleteJob(job.id);
  return reply.code(204).send();
});

app.post("/api/analyze/upload", async (request: FastifyRequest, reply: FastifyReply) => {
  let job: Job | undefined;
  try {
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: "没有找到视频文件。" });
    if (!part.mimetype.startsWith("video/")) return reply.code(415).send({ error: "请放入视频文件。" });
    const analysisSpec = parseAnalysisSpec({
      instruction: multipartFieldValue(part.fields, "instruction"),
      outputSchema: multipartFieldValue(part.fields, "outputSchema"),
      artifactFormats: multipartFieldValue(part.fields, "artifactFormats")
    });
    if (!acceptDemoRequest(request, reply)) return;
    const language = requestLanguage((request.query as { lang?: string } | undefined)?.lang);
    const ownerId = ensureViewerIdentity(request, reply);
    job = await createJob({ source: "upload", title: part.filename, language, analysisSpec, ownerId });
    const inputPath = join(job.dir, `input${extensionFor(part.filename)}`);
    job.inputPath = inputPath;
    job.inputMimeType = part.mimetype;
    await streamToFile(part.file as unknown as NodeJS.ReadableStream, inputPath, config.maxUploadBytes);
    if (part.file.truncated) throw new Error(`视频太大了，第一版最多支持 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB。`);
    enqueueAnalysis(job);
    return reply.code(202).send({ jobId: job.id });
  } catch (error) {
    if (job) await deleteJob(job.id);
    return reply.code(statusCodeOf(error) || 400).send({ error: messageOf(error) });
  }
});

app.post("/api/analyze/url", async (request: FastifyRequest, reply: FastifyReply) => {
  let job: Job | undefined;
  try {
    const body = request.body as { url?: unknown; lang?: unknown; instruction?: unknown; outputSchema?: unknown; artifactFormats?: unknown } | undefined;
    const rawUrl = body?.url;
    const url = normalizeVideoUrl(extractUrlFromText(rawUrl) || (typeof rawUrl === "string" ? rawUrl.trim() : ""));
    validateVideoUrl(url);
    const analysisSpec = parseAnalysisSpec({ instruction: body?.instruction, outputSchema: body?.outputSchema, artifactFormats: body?.artifactFormats });
    if (!acceptDemoRequest(request, reply)) return;
    const ownerId = ensureViewerIdentity(request, reply);
    job = await createJob({ source: "url", title: new URL(url).pathname.split("/").pop() || "视频地址", language: requestLanguage(body?.lang), analysisSpec, ownerId });
    job.sourceUrl = url;
    updateJob(job, { progress: { stage: "resolving", percent: 5, detail: "正在解析视频真实地址。" } });
    enqueueAnalysis(job);
    return reply.code(202).send({ jobId: job.id });
  } catch (error) {
    if (job) await deleteJob(job.id);
    return reply.code(statusCodeOf(error) || 400).send({ error: messageOf(error) });
  }
});

app.get("/api/jobs/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  const ownerId = readViewerOwnerId(request.headers.cookie);
  return reply.header("cache-control", "no-store").send({ ...serializeJob(job), owned: Boolean(ownerId && job.ownerId === ownerId) });
});

// Programmatic callers can fetch exactly the requested JSON value without Koma's summary wrapper.
app.get("/api/jobs/:id/extraction", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  if (job.status !== "done" || !job.result) return reply.code(409).send({ error: "结构化提取还没有完成。" });
  if (!Object.prototype.hasOwnProperty.call(job.result, "extractedData")) {
    return reply.code(404).send({ error: "这次任务没有请求结构化提取。" });
  }
  return reply.header("cache-control", "no-store").type("application/json; charset=utf-8").send(JSON.stringify(job.result.extractedData));
});

app.get("/api/jobs/:id/artifacts/:artifactId", async (request: FastifyRequest<{ Params: { id: string; artifactId: string } }>, reply: FastifyReply) => {
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  if (job.status !== "done" || !job.result) return reply.code(409).send({ error: "产物文件还没有生成完成。" });
  const artifact = job.result.artifacts?.find((item) => item.id === request.params.artifactId);
  if (!artifact?.storageKey) return reply.code(404).send({ error: "找不到这个产物文件。" });
  return sendStoredObject(request, reply, artifact.storageKey, artifact.mimeType, contentDisposition(artifact.name));
});

app.delete("/api/jobs/:id", async (_request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  return reply.code(405).header("allow", "GET").send({ error: "公开回看链接不能直接删除任务，请从“我的任务”删除自己提交的内容。" });
});

app.get("/api/jobs/:id/frames/:filename", async (request: FastifyRequest<{ Params: { id: string; filename: string } }>, reply: FastifyReply) => {
  const job = await loadJob(request.params.id);
  if (!job || !job.result) return reply.code(404).send({ error: "找不到这张关键帧。" });
  const filename = basename(request.params.filename);
  const frame = job.result.frames.find((item) => item.filename === filename);
  if (!frame?.storageKey) return reply.code(404).send({ error: "找不到这张关键帧。" });
  return sendStoredObject(request, reply, frame.storageKey, "image/jpeg");
});

app.get("/api/temp/:token", async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
  const filePath = getTempAudio(request.params.token);
  if (!filePath) return reply.code(404).send({ error: "这个临时文件已经消失了。" });
  try {
    const info = await stat(filePath);
    return reply
      .header("content-type", "audio/mpeg")
      .header("content-length", info.size)
      .header("cache-control", "no-store")
      .send(createReadStream(filePath));
  } catch {
    return reply.code(404).send({ error: "这个临时文件已经消失了。" });
  }
});

app.get("/api/jobs/:id/video", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  const job = await loadJob(request.params.id);
  if (!job?.inputObjectKey || !job.mediaAvailable) return reply.code(404).send({ error: "找不到这段视频。" });
  return sendStoredObject(request, reply, job.inputObjectKey, normalizeVideoContentType(job.inputMimeType));
});

async function sendStoredObject(request: FastifyRequest, reply: FastifyReply, key: string, mimeType: string, disposition?: string) {
  try {
    const object = await storedObjectInfo(key);
    if ("url" in object) {
      return reply.header("cache-control", "no-store").redirect(object.url);
    }
    const rangeHeader = request.headers.range;
    const range = rangeHeader ? parseByteRange(rangeHeader, object.size) : null;
    if (rangeHeader && !range) return reply.code(416).header("content-range", `bytes */${object.size}`).send();
    reply.header("accept-ranges", "bytes").header("cache-control", "private, max-age=3600").type(mimeType);
    if (disposition) reply.header("content-disposition", disposition);
    if (!range) return reply.header("content-length", object.size).send(createReadStream(object.path));
    return reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${object.size}`)
      .header("content-length", range.end - range.start + 1)
      .send(createReadStream(object.path, range));
  } catch {
    return reply.code(404).send({ error: "找不到这个持久化文件。" });
  }
}

const distPath = resolve("dist");
try {
  await stat(distPath);
  await app.register(fastifyStatic, { root: distPath });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) return reply.code(404).send({ error: "没有找到这个地址。" });
    return reply.sendFile("index.html");
  });
} catch {
  app.get("/", async (_, reply) => reply.type("text/plain").send("Run npm run dev for the frontend, or npm run build first."));
}

await app.listen({ port: config.port, host: "0.0.0.0" });

function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!adminAuthEnabled()) {
    reply.code(503).send({ error: "管理后台尚未启用，请先配置 ADMIN_PASSWORD。" });
    return false;
  }
  if (!isAdminSession(request.headers.cookie)) {
    reply.code(401).send({ error: "管理员登录已失效，请重新登录。" });
    return false;
  }
  return true;
}

function requireAdminMutation(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!adminMutationHeader(request)) {
    reply.code(403).send({ error: "管理请求校验失败。" });
    return false;
  }
  return requireAdmin(request, reply);
}

function adminMutationHeader(request: FastifyRequest): boolean {
  return request.headers["x-koma-admin"] === "1";
}

function viewerMutationHeader(request: FastifyRequest): boolean {
  return request.headers["x-koma-user"] === "1";
}

function ensureViewerIdentity(request: FastifyRequest, reply: FastifyReply): string {
  const identity = resolveViewerIdentity(request.headers.cookie);
  if (identity.created) reply.header("set-cookie", viewerSessionCookie(identity.token, isSecureRequest(request)));
  return identity.ownerId;
}

function isSecureRequest(request: FastifyRequest): boolean {
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "").split(",", 1)[0].trim().toLowerCase();
  return request.protocol === "https" || forwardedProtocol === "https" || config.publicBaseUrl.startsWith("https://");
}

function publicHistoryRecord(job: JobHistoryRecord) {
  return {
    id: job.id,
    source: job.source,
    title: job.title,
    status: job.status,
    progress: { stage: job.stage, percent: job.percent, detail: job.detail },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    mediaAvailable: job.mediaAvailable,
    error: job.error
  };
}

function validateVideoUrl(value: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error("请输入视频地址。");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("只支持 http 或 https 视频地址。");
  if (isPrivateHost(parsed.hostname)) throw new Error("不支持访问本机或内网地址。");
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "0.0.0.0", "::1"].includes(normalized) || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  if (isIP(normalized) !== 4) return isIP(normalized) === 6 && (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"));
  const octets = normalized.split(".").map(Number);
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254);
}

function extensionFor(filename: string): string {
  const extension = filename.match(/\.[a-z0-9]{2,5}$/i)?.[0]?.toLowerCase();
  return extension || ".mp4";
}

function normalizeVideoContentType(value: string | undefined): string {
  const type = typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
  return type.startsWith("video/") ? type : "video/mp4";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusCodeOf(error: unknown): number | undefined {
  return (error as { statusCode?: number })?.statusCode;
}

function acceptDemoRequest(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.demoRequestsPerIpPerDay) return true;
  const result = demoLimiter.consume(request.ip);
  reply
    .header("x-ratelimit-limit", config.demoRequestsPerIpPerDay)
    .header("x-ratelimit-remaining", result.remaining)
    .header("x-ratelimit-reset", Math.floor(result.resetAt / 1000));
  if (result.allowed) return true;
  reply.code(429).send({ error: "今天的公开演示次数已经用完，请明天再来，或在本地配置自己的模型 Key。" });
  return false;
}

// 客户端把界面语言随请求带来，AI 生成文案按该语言输出；缺省中文。
function requestLanguage(value: unknown): "en" | "zh" {
  return value === "en" ? "en" : "zh";
}

function multipartFieldValue(fields: unknown, name: string): unknown {
  if (!fields || typeof fields !== "object") return undefined;
  const raw = (fields as Record<string, unknown>)[name];
  const field = Array.isArray(raw) ? raw[0] : raw;
  if (!field || typeof field !== "object") return undefined;
  return (field as { value?: unknown }).value;
}
