import { createReadStream } from "node:fs";
import { copyFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { isIP } from "node:net";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { config } from "./config/config.js";
import { createJob, deleteJob, getJobAbortSignal, loadJob, serializeJob, updateJob, type Job } from "./application/jobs.js";
import { getTempAudio } from "./media/temp-audio.js";
import { enqueueAnalysis } from "./application/pipeline.js";
import { retainedInputPath } from "./application/retry-source.js";
import { streamToFile } from "./media/download.js";
import { extractUrlFromText } from "./media/resolver.js";
import { normalizeVideoUrl } from "./media/url-source.js";
import { parseByteRange } from "./media/video-stream.js";
import { createDailyLimiter } from "./http/rate-limit.js";
import { observeMultipartCompletion } from "./http/multipart-completion.js";
import { frontendResponseHeaders, registerFrontend } from "./http/frontend.js";
import { ARTIFACT_FORMATS, MAX_OUTPUT_SCHEMA_CHARS, parseAnalysisSpec } from "./analysis/analysis-spec.js";
import { generateAnalysisSpec, validateAnalysisSpecGenerationLanguage, validateAnalysisSpecGenerationRequest } from "./analysis/analysis-spec-ai.js";
import { contentDisposition } from "./persistence/artifacts.js";
import {
  adminAuthEnabled,
  adminSessionCookie,
  analysisAuthRequired,
  clearAdminSessionCookie,
  createAdminSession,
  isAdminSession,
  revokeAdminSession
} from "./auth/admin-auth.js";
import { databaseDriver, initializeDatabase, listJobHistory, claimLegacyJobs, listAccountJobHistory, listLegacyJobHistory, readJobAccount, readJobSource, markInterruptedJobs, type JobHistoryRecord } from "./persistence/database.js";
import { getRuntimeProviders, getSafeProviderSettings, initializeProviderSettings, resetProviderSettings, updateProviderSettings } from "./analysis/provider-runtime.js";
import { copyStoredFile, makeStoredPrefixPrivate, initializeStorage, storageHealth, storedObjectInfo } from "./persistence/storage.js";
import { readViewerOwnerId } from "./auth/viewer-session.js";

import { beginGithubLogin, clearAccountCookie, clearGithubLoginCookie, completeGithubLogin, currentAccount, githubAuthEnabled, revokeAccountSession } from "./auth/github-auth.js";

await initializeDatabase();
await markInterruptedJobs();
await initializeStorage();
await initializeProviderSettings();

const app = Fastify({
  logger: {
    serializers: { req: (request) => ({ method: request.method, url: String(request.url || "").split("?", 1)[0], hostname: request.hostname, remoteAddress: request.ip }) },
    redact: ["req.headers.cookie", "req.headers.authorization", "res.headers.set-cookie"]
  },
  bodyLimit: 64 * 1024, trustProxy: config.trustProxy
});
const demoLimiter = createDailyLimiter(config.demoRequestsPerIpPerDay);
const loginLimiter = createDailyLimiter(100);
await app.register(multipart, { limits: { files: 1, fileSize: config.maxUploadBytes } });
app.addHook("onRequest", frontendResponseHeaders);

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
    features: { githubLogin: true, privateWorkspace: true, legacyClaim: true, jobRetry: true, customExtraction: true, analysisSpecGeneration: true, rawExtractionEndpoint: true, downloadableArtifacts: true, permanentReplay: true, viewerHistory: true, viewerOwnedDeletion: true, artifactFormats: ARTIFACT_FORMATS, admin: adminAuthEnabled(), analysisRequiresAdmin: analysisAuthRequired() },
    configured: { github: githubAuthEnabled(), asr: asrConfigured, vision: visionConfigured, analysis: visionConfigured },
    database: { driver: databaseDriver() },
    storage: storageHealth(),
    demoLimitPerIpPerDay: config.demoRequestsPerIpPerDay || null,
    mock: { asr: providers.asr.provider === "mock", vision: providers.vision.provider === "mock", analysis: providers.vision.provider === "mock" }
  };
});

app.post("/api/analysis-spec/generate", { bodyLimit: 16 * 1024, onRequest: requireAnalysisAccess }, async (request, reply) => {
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

app.get("/api/auth/session", async (request, reply) => {
  const user = await currentAccount(request.headers.cookie);
  const legacyOwner = user && readViewerOwnerId(request.headers.cookie);
  const legacyJobCount = legacyOwner ? (await listLegacyJobHistory(legacyOwner)).length : 0;
  return reply.header("cache-control", "no-store").send({ enabled: githubAuthEnabled(), authenticated: Boolean(user), user, legacyJobCount });
});

app.get("/api/auth/github", async (request, reply) => {
  const limit = loginLimiter.consume(request.ip);
  if (!limit.allowed) return reply.header("cache-control", "no-store").header("retry-after", Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000))).code(429).send({ error: "登录尝试过多，请稍后再试。" });
  const login = await beginGithubLogin((request.query as { returnTo?: unknown }).returnTo, isSecureRequest(request));
  reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
  if (!login) return reply.redirect("/?auth=unavailable");
  return reply.header("set-cookie", login.cookie).redirect(login.url);
});

app.get("/api/auth/github/callback", async (request, reply) => {
  const secure = isSecureRequest(request);
  const result = await completeGithubLogin(request.query as { state?: unknown; code?: unknown; error?: unknown }, request.headers.cookie, secure);
  reply.header("cache-control", "no-store").header("referrer-policy", "no-referrer");
  reply.header("set-cookie", result.ok ? [clearGithubLoginCookie(secure), result.cookie] : clearGithubLoginCookie(secure));
  return reply.redirect(result.ok ? result.returnTo : `/?auth=${result.reason}`);
});

app.delete("/api/auth/session", async (request, reply) => {
  if (!viewerMutationHeader(request)) return reply.code(403).send({ error: "用户请求校验失败。" });
  await revokeAccountSession(request.headers.cookie);
  return reply.header("cache-control", "no-store").header("set-cookie", clearAccountCookie(isSecureRequest(request))).code(204).send();
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
  const user = await requireAccount(request, reply);
  if (!user) return;
  const jobs = await Promise.all((await listAccountJobHistory(user.id, 200)).map(accountHistoryRecord));
  return reply.header("cache-control", "no-store").send({ jobs });
});

app.get("/api/my/jobs/legacy", async (request, reply) => {
  if (!await requireAccount(request, reply)) return;
  const ownerId = readViewerOwnerId(request.headers.cookie);
  const jobs = ownerId ? (await listLegacyJobHistory(ownerId)).map(publicHistoryRecord) : [];
  return reply.header("cache-control", "no-store").send({ jobs });
});

app.post("/api/my/jobs/claim", async (request, reply) => {
  if (!viewerMutationHeader(request)) return reply.code(403).send({ error: "用户请求校验失败。" });
  const user = await requireAccount(request, reply);
  if (!user) return;
  const ownerId = readViewerOwnerId(request.headers.cookie);
  if (ownerId) {
    try {
      for (const job of await listLegacyJobHistory(ownerId)) await makeStoredPrefixPrivate(job.storagePrefix);
    } catch {
      return reply.code(503).send({ error: "暂时无法保护旧任务的文件，尚未迁移，请稍后重试。" });
    }
  }
  const claimed = ownerId ? await claimLegacyJobs(ownerId, user.id) : 0;
  return reply.header("cache-control", "no-store").send({ claimed });
});

app.delete("/api/my/jobs/:id", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  if (!viewerMutationHeader(request)) return reply.code(403).send({ error: "用户请求校验失败。" });
  const user = await requireAccount(request, reply);
  if (!user) return;
  if (await readJobAccount(request.params.id) !== user.id) return reply.code(404).send({ error: "找不到这次分析。" });
  await deleteJob(request.params.id);
  return reply.code(204).send();
});

app.post<{ Params: { id: string } }>("/api/my/jobs/:id/retry", { onRequest: requireAnalysisAccess }, async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
  const user = await currentAccount(request.headers.cookie);
  if (!user || await readJobAccount(request.params.id) !== user.id) return reply.code(404).send({ error: "找不到这次分析。" });
  const previous = await loadJob(request.params.id);
  if (!previous) return reply.code(404).send({ error: "找不到这次分析。" });
  if (previous.status !== "failed") return reply.code(409).send({ error: "只有失败的任务可以重试。" });
  if (!await canRetryJob(previous)) return reply.code(409).send({ error: "原视频已不可用，请重新上传或粘贴视频链接。" });
  if (!acceptDemoRequest(request, reply)) return;
  let next: Job | undefined;
  try {
    next = await createJob({ source: previous.source, title: previous.title, language: previous.language, analysisSpec: previous.analysisSpec, accountId: user.id, sourceUrl: previous.sourceUrl });
    if (previous.inputObjectKey && previous.mediaAvailable) {
      next.inputPath = join(next.dir, `input${extensionFor(previous.inputObjectKey)}`);
      next.inputMimeType = previous.inputMimeType;
      await copyStoredFile(previous.inputObjectKey, next.inputPath);
      // Already retained media takes priority over re-fetching an expiring link.
      next.sourceUrl = undefined;
    } else {
      const retained = await retainedInputPath(previous);
      if (retained) {
        next.inputPath = join(next.dir, `input${extensionFor(retained)}`);
        next.inputMimeType = previous.inputMimeType;
        await copyFile(retained, next.inputPath);
        next.sourceUrl = undefined;
      }
    }
    enqueueAnalysis(next);
    return reply.header("cache-control", "no-store").code(202).send({ jobId: next.id });
  } catch {
    if (next) await deleteJob(next.id);
    return reply.code(409).send({ error: "暂时无法读取原视频，请重新上传或粘贴视频链接。" });
  }
});

app.post("/api/analyze/upload", { onRequest: requireAnalysisAccess }, async (request: FastifyRequest, reply: FastifyReply) => {
  let job: Job | undefined;
  let uploadSignal: AbortSignal | undefined;
  let completion: ReturnType<typeof observeMultipartCompletion> | undefined;
  try {
    const language = requestLanguage((request.query as { lang?: string } | undefined)?.lang);
    const user = await requireAccount(request, reply);
    if (!user) return;
    if (!acceptDemoRequest(request, reply, false)) return;
    const fields: Record<string, unknown> = Object.create(null);
    completion = observeMultipartCompletion(request.raw);
    // Consume every part before scheduling: fields may follow the video, and later parts can fail.
    for await (const part of request.parts({ limits: { files: 1, fields: 8, fieldSize: MAX_OUTPUT_SCHEMA_CHARS * 4 } })) {
      if (part.type === "field") {
        if (part.fieldnameTruncated || part.valueTruncated) throw Object.assign(new Error("上传字段太大或不完整。"), { statusCode: 413 });
        if (Object.hasOwn(fields, part.fieldname)) throw Object.assign(new Error("上传字段不能重复。"), { statusCode: 400 });
        fields[part.fieldname] = part.value;
        continue;
      }
      if (!part.mimetype.startsWith("video/")) throw Object.assign(new Error("请放入视频文件。"), { statusCode: 415 });
      job = await createJob({ source: "upload", title: part.filename, language, analysisSpec: parseAnalysisSpec(fields), accountId: user.id });
      uploadSignal = getJobAbortSignal(job.id);
      const inputPath = join(job.dir, `input${extensionFor(part.filename)}`);
      job.inputPath = inputPath;
      job.inputMimeType = part.mimetype;
      const bytes = await streamToFile(part.file, inputPath, config.maxUploadBytes, 0, undefined, uploadSignal);
      if (part.file.truncated) throw Object.assign(new Error(`视频太大了，第一版最多支持 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB。`), { statusCode: 413 });
      if (!bytes) throw new Error("视频文件为空，请重新上传。");
    }
    completion.assertComplete();
    if (!job) return reply.code(400).send({ error: "没有找到视频文件。" });
    const analysisSpec = parseAnalysisSpec(fields);
    uploadSignal?.throwIfAborted();
    if (!acceptDemoRequest(request, reply)) {
      await deleteJob(job.id);
      return;
    }
    updateJob(job, { analysisSpec });
    enqueueAnalysis(job);
    return reply.code(202).send({ jobId: job.id });
  } catch (error) {
    if (job) await deleteJob(job.id);
    return reply.code(statusCodeOf(error) || 400).send({ error: messageOf(error) });
  } finally {
    completion?.dispose();
  }
});

app.post("/api/analyze/url", { onRequest: requireAnalysisAccess }, async (request: FastifyRequest, reply: FastifyReply) => {
  let job: Job | undefined;
  try {
    const body = request.body as { url?: unknown; lang?: unknown; instruction?: unknown; outputSchema?: unknown; artifactFormats?: unknown } | undefined;
    const rawUrl = body?.url;
    const url = normalizeVideoUrl(extractUrlFromText(rawUrl) || (typeof rawUrl === "string" ? rawUrl.trim() : ""));
    validateVideoUrl(url);
    const analysisSpec = parseAnalysisSpec({ instruction: body?.instruction, outputSchema: body?.outputSchema, artifactFormats: body?.artifactFormats });
    if (!acceptDemoRequest(request, reply)) return;
    const user = await requireAccount(request, reply);
    if (!user) return;
    const accountId = user.id;
    job = await createJob({ source: "url", title: new URL(url).pathname.split("/").pop() || "视频地址", language: requestLanguage(body?.lang), analysisSpec, accountId, sourceUrl: url });
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
  const access = await canAccessJob(request, job.id);
  if (!access.allowed) return reply.code(404).send({ error: "找不到这次分析。" });
  return reply.header("cache-control", "no-store").send({ ...serializeJob(job), owned: access.owned, visibility: access.private ? "private" : "legacy-link", retryable: access.owned && await canRetryJob(job) });
});

// Programmatic callers can fetch exactly the requested JSON value without Koma's summary wrapper.
app.get("/api/jobs/:id/extraction", async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  if (!(await canAccessJob(request, request.params.id)).allowed) return reply.code(404).send({ error: "找不到这次分析。" });
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  if (job.status !== "done" || !job.result) return reply.code(409).send({ error: "结构化提取还没有完成。" });
  if (!Object.prototype.hasOwnProperty.call(job.result, "extractedData")) {
    return reply.code(404).send({ error: "这次任务没有请求结构化提取。" });
  }
  return reply.header("cache-control", "no-store").type("application/json; charset=utf-8").send(JSON.stringify(job.result.extractedData));
});

app.get("/api/jobs/:id/artifacts/:artifactId", async (request: FastifyRequest<{ Params: { id: string; artifactId: string } }>, reply: FastifyReply) => {
  if (!(await canAccessJob(request, request.params.id)).allowed) return reply.code(404).send({ error: "找不到这次分析。" });
  const job = await loadJob(request.params.id);
  if (!job) return reply.code(404).send({ error: "找不到这次分析。" });
  if (job.status !== "done" || !job.result) return reply.code(409).send({ error: "产物文件还没有生成完成。" });
  const artifact = job.result.artifacts?.find((item) => item.id === request.params.artifactId);
  if (!artifact?.storageKey) return reply.code(404).send({ error: "找不到这个产物文件。" });
  return sendStoredObject(request, reply, artifact.storageKey, artifact.mimeType, contentDisposition(artifact.name));
});

app.delete("/api/jobs/:id", async (_request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
  return reply.code(405).header("allow", "GET").send({ error: "回看页面不能直接删除任务，请从资料库或管理后台删除。" });
});

app.get("/api/jobs/:id/frames/:filename", async (request: FastifyRequest<{ Params: { id: string; filename: string } }>, reply: FastifyReply) => {
  if (!(await canAccessJob(request, request.params.id)).allowed) return reply.code(404).send({ error: "找不到这次分析。" });
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
  if (!(await canAccessJob(request, request.params.id)).allowed) return reply.code(404).send({ error: "找不到这次分析。" });
  const job = await loadJob(request.params.id);
  if (!job?.inputObjectKey || !job.mediaAvailable) return reply.code(404).send({ error: "找不到这段视频。" });
  return sendStoredObject(request, reply, job.inputObjectKey, normalizeVideoContentType(job.inputMimeType));
});

async function sendStoredObject(request: FastifyRequest, reply: FastifyReply, key: string, mimeType: string, disposition?: string) {
  try {
    const object = await storedObjectInfo(key, { private: true, contentDisposition: disposition });
    if ("url" in object) {
      return reply.header("cache-control", "no-store").redirect(object.url);
    }
    const rangeHeader = request.headers.range;
    const range = rangeHeader ? parseByteRange(rangeHeader, object.size) : null;
    if (rangeHeader && !range) return reply.code(416).header("content-range", `bytes */${object.size}`).send();
    reply.header("accept-ranges", "bytes").header("cache-control", "private, no-store").type(mimeType);
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

await registerFrontend(app);

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

async function requireAnalysisAccess(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!viewerMutationHeader(request)) {
    reply.code(403).send({ error: "用户请求校验失败。" });
    return;
  }
  if (!await requireAccount(request, reply)) return;
  if (analysisAuthRequired() && !isAdminSession(request.headers.cookie)) {
    reply.header("cache-control", "no-store").code(403).send({ error: "当前服务仅允许管理员开始分析。" });
  }
}

async function requireAccount(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentAccount(request.headers.cookie);
  if (!user) reply.header("cache-control", "no-store").code(401).send({ error: "请先使用 GitHub 登录，再继续操作。" });
  return user;
}

async function canAccessJob(request: FastifyRequest, jobId: string) {
  const job = await loadJob(jobId);
  if (!job) return { private: false, owned: false, allowed: false };
  // Deletion can remove the relation while this request still holds the private job snapshot.
  const accountId = await readJobAccount(jobId) || job.accountId;
  const user = await currentAccount(request.headers.cookie);
  const owned = Boolean(accountId && user?.id === accountId);
  return { private: Boolean(accountId), owned, allowed: !accountId || owned || isAdminSession(request.headers.cookie) };
}

async function canRetryJob(job: Job): Promise<boolean> {
  if (job.status !== "failed") return false;
  job.sourceUrl ||= await readJobSource(job.id) || undefined;
  return Boolean(job.sourceUrl || (job.inputObjectKey && job.mediaAvailable) || await retainedInputPath(job));
}

async function accountHistoryRecord(record: JobHistoryRecord) {
  const job = await loadJob(record.id);
  return {
    ...publicHistoryRecord(record),
    title: record.status === "done" ? job?.result?.title?.trim() || record.title : record.title,
    sourceTitle: record.title,
    retryable: Boolean(job && await canRetryJob(job)),
    summary: job?.result?.summary || null,
    durationMs: job?.result?.durationMs || null
  };
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
  if (request.headers["x-koma-client"] !== "1" && request.headers["x-koma-user"] !== "1") return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expected = new URL(process.env.GITHUB_CALLBACK_URL || config.publicBaseUrl).origin;
    return new URL(origin).origin === expected;
  } catch { return false; }
}

function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === "https" || (process.env.GITHUB_CALLBACK_URL || config.publicBaseUrl).startsWith("https://");
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

function acceptDemoRequest(request: FastifyRequest, reply: FastifyReply, consume = true): boolean {
  if (!config.demoRequestsPerIpPerDay) return true;
  const result = consume ? demoLimiter.consume(request.ip) : demoLimiter.check(request.ip);
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
