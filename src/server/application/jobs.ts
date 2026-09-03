import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { config, type AsrProvider, type VisionProvider } from "../config/config.js";
import type { TranscriptLine } from "../shared/types.js";
import type { AnalysisSpec } from "../analysis/analysis-spec.js";
import type { Artifact } from "../persistence/artifacts.js";
import { deleteJobRecord, readJobOwner, readJobRecord, writeJobOwner, writeJobRecord, type PersistedJobRecord } from "../persistence/database.js";
import { getRuntimeProviders, type RuntimeProviders } from "../analysis/provider-runtime.js";
import { deleteStoredPrefix, jobStoragePrefix } from "../persistence/storage.js";
export type { TranscriptLine };

export interface Frame {
  filename: string;
  atMs: number;
  caption?: string;
  path?: string;
  storageKey?: string;
}

export interface Chapter {
  startMs: number;
  endMs: number;
  title: string;
  summary: string;
}

export interface Tag {
  label: string;
  category: string;
  atMs: number;
}

export type StoredArtifact = Artifact & { storageKey?: string };

export interface AnalysisResult {
  title: string;
  durationMs: number;
  summary: string;
  tags: Tag[];
  chapters: Chapter[];
  transcript: TranscriptLine[];
  hasSubtitles?: boolean;
  frames: Frame[];
  extractedData?: unknown;
  artifacts?: StoredArtifact[];
}

export interface JobProgress {
  stage: string;
  percent: number;
  detail: string;
}

export interface Job {
  id: string;
  dir: string;
  source: "upload" | "url";
  sourceUrl?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  status: "queued" | "processing" | "done" | "failed";
  progress: JobProgress;
  result: AnalysisResult | null;
  error: string | null;
  inputPath?: string;
  inputMimeType?: string;
  inputObjectKey?: string;
  storagePrefix: string;
  mediaAvailable: boolean;
  language: "en" | "zh";
  analysisSpec: AnalysisSpec;
  providers: RuntimeProviders;
  ownerId?: string;
}

const jobs = new Map<string, Job>();
const abortControllers = new Map<string, AbortController>();
const persistenceQueues = new Map<string, Promise<void>>();

export async function createJob({ source, title, language = "zh", analysisSpec = {}, providers = getRuntimeProviders(), ownerId }: { source: Job["source"]; title: string; language?: "en" | "zh"; analysisSpec?: AnalysisSpec; providers?: RuntimeProviders; ownerId?: string }): Promise<Job> {
  const id = randomUUID();
  const dir = join(config.tempRoot, `koma-${id}`);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const job: Job = {
    id,
    dir,
    source,
    title: title || "未命名视频",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    status: "queued",
    progress: { stage: "queued", percent: 4, detail: "任务已经进入处理队列。" },
    result: null,
    error: null,
    storagePrefix: jobStoragePrefix(id),
    mediaAvailable: false,
    language,
    analysisSpec,
    providers,
    ownerId
  };
  jobs.set(id, job);
  abortControllers.set(id, new AbortController());
  try {
    await writeJobRecord(toPersistedRecord(job));
    if (ownerId) await writeJobOwner(id, ownerId, now);
  } catch (error) {
    jobs.delete(id);
    abortControllers.delete(id);
    await deleteJobRecord(id).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return job;
}

export function getJobAbortSignal(id: string): AbortSignal | undefined {
  return abortControllers.get(id)?.signal;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export async function loadJob(id: string): Promise<Job | undefined> {
  const active = jobs.get(id);
  if (active) return active;
  const record = await readJobRecord(id);
  if (!record) return undefined;
  const job = fromPersistedRecord(record, await readJobOwner(id));
  jobs.set(id, job);
  return job;
}

export function updateJob(job: Job, patch: Partial<Job>): Job {
  Object.assign(job, patch);
  job.updatedAt = Date.now();
  if (job.status === "done" && !job.completedAt) job.completedAt = job.updatedAt;
  queuePersistence(job);
  return job;
}

export async function flushJob(job: Job): Promise<void> {
  await persistenceQueues.get(job.id);
}

export function serializeJob(job: Job | undefined) {
  if (!job) return null;
  const result = job.result && {
    ...job.result,
    videoUrl: job.mediaAvailable ? `/api/jobs/${job.id}/video` : undefined,
    artifacts: job.result.artifacts?.map(({ content: _content, storageKey: _storageKey, ...artifact }) => ({
      ...artifact,
      downloadUrl: `/api/jobs/${job.id}/artifacts/${artifact.id}`
    })),
    frames: job.result.frames.map(({ path: _path, storageKey: _storageKey, ...frame }) => ({
      ...frame,
      url: `/api/jobs/${job.id}/frames/${encodeURIComponent(frame.filename)}`
    }))
  };
  return {
    id: job.id,
    source: job.source,
    title: job.title,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    status: job.status,
    progress: job.progress,
    language: job.language,
    analysisSpec: job.analysisSpec,
    providers: {
      asr: { provider: job.providers.asr.provider, model: job.providers.asr.model },
      vision: { provider: job.providers.vision.provider, model: job.providers.vision.model }
    },
    result,
    error: job.error
  };
}

export async function deleteJob(id: string): Promise<void> {
  const job = jobs.get(id) || await loadJob(id);
  abortControllers.get(id)?.abort();
  abortControllers.delete(id);
  await persistenceQueues.get(id);
  persistenceQueues.delete(id);
  jobs.delete(id);
  if (job) {
    await deleteStoredPrefix(job.storagePrefix).catch((error) => console.warn(`[koma] 无法清理任务存储：${messageOf(error)}`));
    await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await deleteJobRecord(id);
}

export async function releaseWorkingDirectory(job: Job): Promise<void> {
  await flushJob(job);
  await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
  job.inputPath = undefined;
}

function queuePersistence(job: Job): void {
  const previous = persistenceQueues.get(job.id) || Promise.resolve();
  const snapshot = toPersistedRecord(job);
  const update = previous
    .catch((error) => console.warn(`[koma] 上一次任务持久化失败：${messageOf(error)}`))
    .then(() => writeJobRecord(snapshot));
  persistenceQueues.set(job.id, update);
  void update.catch((error) => console.warn(`[koma] 无法持久化任务：${messageOf(error)}`));
  void update.finally(() => {
    if (persistenceQueues.get(job.id) === update) persistenceQueues.delete(job.id);
  }).catch(() => undefined);
}

function toPersistedRecord(job: Job): PersistedJobRecord {
  return {
    id: job.id,
    source: job.source,
    title: job.title,
    status: job.status,
    stage: job.progress.stage,
    percent: job.progress.percent,
    detail: job.progress.detail,
    language: job.language,
    analysisSpec: job.analysisSpec,
    result: persistentResult(job.result),
    asrProvider: job.providers.asr.provider,
    asrModel: job.providers.asr.model,
    visionProvider: job.providers.vision.provider,
    visionModel: job.providers.vision.model,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    storagePrefix: job.storagePrefix,
    inputObjectKey: job.inputObjectKey || null,
    inputMimeType: job.inputMimeType || null,
    mediaAvailable: job.mediaAvailable,
    error: job.error
  };
}

function persistentResult(result: AnalysisResult | null): AnalysisResult | null {
  if (!result) return null;
  return {
    ...result,
    frames: result.frames.map(({ path: _path, ...frame }) => frame),
    artifacts: result.artifacts?.map(({ content: _content, ...artifact }) => ({ ...artifact, content: "" }))
  };
}

function fromPersistedRecord(record: PersistedJobRecord, ownerId: string | null): Job {
  const result = record.result && typeof record.result === "object" ? record.result as AnalysisResult : null;
  return {
    id: record.id,
    dir: join(config.tempRoot, `koma-${record.id}`),
    source: record.source,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    status: normalizeStatus(record.status),
    progress: { stage: record.stage, percent: record.percent, detail: record.detail },
    result,
    error: record.error,
    inputMimeType: record.inputMimeType || undefined,
    inputObjectKey: record.inputObjectKey || undefined,
    storagePrefix: record.storagePrefix,
    mediaAvailable: record.mediaAvailable,
    language: record.language,
    analysisSpec: record.analysisSpec && typeof record.analysisSpec === "object" ? record.analysisSpec as AnalysisSpec : {},
    ownerId: ownerId || undefined,
    providers: {
      asr: { provider: record.asrProvider as AsrProvider, apiKey: "", baseUrl: "", model: record.asrModel },
      vision: { provider: record.visionProvider as VisionProvider, apiKey: "", baseUrl: "", model: record.visionModel }
    }
  };
}

function normalizeStatus(value: string): Job["status"] {
  return value === "queued" || value === "processing" || value === "done" ? value : "failed";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
