import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { config } from "../config/config.js";
import { registerTempAudio, removeTempAudio } from "./temp-audio.js";
import { extractFullAudio } from "./video.js";
import type { AudioSegment, TranscriptLine } from "../shared/types.js";
import { getRuntimeProviders, type RuntimeProvider } from "../analysis/provider-runtime.js";
import type { AsrProvider } from "../config/config.js";

// 字幕级听写走同步 Fun-ASR-Flash（base64 直传，无需公网地址），
// 返回词级时间戳后按标点/停顿聚合为字幕行。
// 说话人分离走异步 Fun-ASR（需要 PUBLIC_BASE_URL 提供公网音频地址），
// 整段音频一次性交给模型，返回每句的 speaker_id。
const asyncAsrModel = "fun-asr";

interface TranscribeOptions {
  audioSegments?: AudioSegment[];
  durationMs?: number;
  fetchImpl?: typeof fetch;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function transcribe({
  audioSegments,
  durationMs,
  fetchImpl = fetch,
  provider = config.asrProvider,
  apiKey = config.asrApiKey,
  baseUrl = config.asrBaseUrl,
  model = config.asrModel,
  maxBytes = config.asrMaxSegmentBytes,
  timeoutMs = config.aiTimeoutMs,
  signal
}: TranscribeOptions): Promise<TranscriptLine[]> {
  if (provider === "mock") return mockTranscript(durationMs);
  if (!apiKey || !baseUrl || !model) throw new Error(`ASR_PROVIDER=${provider} 缺少 API Key、Base URL 或模型配置。`);

  const transcript: TranscriptLine[] = [];
  for (const segment of audioSegments || []) {
    if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
    const lines = provider === "dashscope"
      ? await requestSegmentSubtitle({ segment, apiKey, baseUrl, model, maxBytes, timeoutMs, fetchImpl, signal })
      : await requestOpenAICompatibleSubtitle({ segment, apiKey, baseUrl, model, maxBytes, timeoutMs, fetchImpl, signal });
    for (const line of lines) {
      transcript.push({
        ...line,
        startMs: line.startMs + segment.startMs,
        endMs: line.endMs + segment.startMs
      });
    }
  }
  return transcript;
}

export async function transcribeFullAudio({
  inputPath,
  audioDir,
  publicBaseUrl,
  fetchImpl = fetch,
  signal,
  providerConfig = getRuntimeProviders().asr
}: {
  inputPath: string;
  audioDir: string;
  publicBaseUrl: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  providerConfig?: RuntimeProvider<AsrProvider>;
}): Promise<TranscriptLine[]> {
  if (providerConfig.provider !== "dashscope") throw new Error(`未知的 ASR_PROVIDER：${providerConfig.provider}`);
  if (!providerConfig.apiKey) throw new Error("配置 DashScope API Key 后才能使用说话人分离。");
  if (!publicBaseUrl) throw new Error("说话人分离需要配置 PUBLIC_BASE_URL（服务的公网地址）。");

  const audioPath = join(audioDir, `diarization-${randomUUID()}.mp3`);
  await extractFullAudio(inputPath, audioPath, { signal });
  const token = registerTempAudio(audioPath);
  const fileUrl = `${publicBaseUrl}/api/temp/${token}`;
  try {
    const taskId = await submitAsrTask({
      fileUrl,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      model: asyncAsrModel,
      timeoutMs: config.aiTimeoutMs,
      fetchImpl,
      signal
    });
    const task = await pollAsrTask({
      taskId,
      apiKey: providerConfig.apiKey,
      baseUrl: providerConfig.baseUrl,
      timeoutMs: Math.max(120_000, config.aiTimeoutMs * 3),
      signal
    });
    return await parseDiarizationTask(task, { apiKey: providerConfig.apiKey, timeoutMs: config.aiTimeoutMs, signal });
  } finally {
    removeTempAudio(token);
    await rm(audioPath, { force: true }).catch(() => undefined);
  }
}

export function groupWordsToSubtitles(words: Array<{ begin_time?: number; end_time?: number; text?: string; punctuation?: string }>, options: { maxLineMs?: number; minGapMs?: number; minLineMs?: number } = {}): TranscriptLine[] {
  const { maxLineMs = 8000, minGapMs = 1500, minLineMs = 1200 } = options;
  const lines: TranscriptLine[] = [];
  let buffer: typeof words = [];
  let startMs: number | null = null;
  let endMs: number | null = null;
  let lastWasTerminal = false;

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer
      .map((word) => String(word.text || ""))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push({ startMs: startMs ?? 0, endMs: endMs ?? startMs ?? 0, text });
    buffer = [];
    startMs = null;
    endMs = null;
    lastWasTerminal = false;
  };

  for (const word of words) {
    const begin = Number(word.begin_time) || 0;
    const end = Number(word.end_time) || begin;
    const punctuation = String(word.punctuation || "");
    const isTerminal = /[.!?。！？…]/.test(punctuation);
    if (buffer.length) {
      const gap = begin - (endMs ?? begin);
      const lineMs = end - (startMs ?? begin);
      if ((lastWasTerminal && lineMs >= minLineMs) || gap > minGapMs || lineMs > maxLineMs) flush();
    }
    buffer.push(word);
    if (startMs === null) startMs = begin;
    endMs = end;
    lastWasTerminal = isTerminal;
  }
  flush();
  return lines;
}

export async function requestSegmentSubtitle({
  segment,
  apiKey,
  baseUrl,
  model,
  maxBytes = 8 * 1024 * 1024,
  timeoutMs = 120000,
  fetchImpl = fetch,
  signal
}: {
  segment: AudioSegment;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<TranscriptLine[]> {
  const audio = await readFile(segment.path);
  if (audio.byteLength > maxBytes) {
    throw new Error(`音频切片超过 ${Math.round(maxBytes / 1024 / 1024)} MB，请缩短 ASR_SEGMENT_SECONDS。`);
  }
  const response = await fetchImpl(`${nativeBaseUrl(baseUrl)}/services/aigc/multimodal-generation/generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "X-DashScope-SSE": "disable"
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [{
          role: "user",
          content: [{
            type: "input_audio",
            input_audio: { data: `data:audio/mpeg;base64,${audio.toString("base64")}` }
          }]
        }]
      },
      parameters: { format: "mp3", sample_rate: "16000" }
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json().catch(() => ({})) as FunAsrSyncResponse;
  if (!response.ok) {
    const message = body.output?.message || (body as { message?: string }).message || (body as { code?: string }).code || `听写模型请求失败：${response.status}`;
    if (/ASR_RESPONSE_HAVE_NO_WORDS/.test(String(message))) return [];
    throw new Error(message);
  }
  const sentence = body.output?.output?.sentence || body.output?.sentence;
  const words = Array.isArray(sentence?.words) ? sentence.words : [];
  const text = compactTranscriptText(sentence?.text || "");
  if (!words.length) {
    if (!text) return [];
    return [{ startMs: segment.startMs, endMs: segment.endMs, text }];
  }
  return groupWordsToSubtitles(words);
}

// OpenAI-compatible transcription adapter. Groq and OpenAI both expose
// /audio/transcriptions and return second-based segment timestamps in verbose_json.
// Koma already splits audio into small MP3 files, so the same adapter also works
// with providers that enforce a per-file upload limit.
export async function requestOpenAICompatibleSubtitle({
  segment,
  apiKey,
  baseUrl,
  model,
  maxBytes = 8 * 1024 * 1024,
  timeoutMs = 120000,
  fetchImpl = fetch,
  signal
}: {
  segment: AudioSegment;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<TranscriptLine[]> {
  const audio = await readFile(segment.path);
  if (audio.byteLength > maxBytes) {
    throw new Error(`音频切片超过 ${Math.round(maxBytes / 1024 / 1024)} MB，请缩短 ASR_SEGMENT_SECONDS。`);
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }), basename(segment.path));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("temperature", "0");

  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json().catch(() => ({})) as OpenAITranscriptionResponse;
  if (!response.ok) {
    throw new Error(body.error?.message || body.message || `听写模型请求失败：${response.status}`);
  }

  const lines = (Array.isArray(body.segments) ? body.segments : [])
    .map((item) => ({
      startMs: Math.max(0, Math.round((Number(item.start) || 0) * 1000)),
      endMs: Math.max(0, Math.round((Number(item.end) || 0) * 1000)),
      text: compactTranscriptText(String(item.text || ""))
    }))
    .filter((line) => line.text);
  if (lines.length) return lines;

  const text = compactTranscriptText(body.text || "");
  return text ? [{ startMs: 0, endMs: Math.max(0, segment.endMs - segment.startMs), text }] : [];
}

async function submitAsrTask({ fileUrl, apiKey, baseUrl, model, timeoutMs, fetchImpl = fetch, signal }: {
  fileUrl: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await fetchImpl(`${nativeBaseUrl(baseUrl)}/services/audio/asr/transcription`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify({
      model,
      input: { file_urls: [fileUrl] },
      parameters: { channel_id: [0], diarization_enabled: true }
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  const body = await response.json().catch(() => ({})) as { output?: { message?: string; task_id?: string }; message?: string; code?: string };
  if (!response.ok) {
    throw new Error(body.output?.message || body.message || body.code || `听写任务提交失败：${response.status}`);
  }
  const taskId = body.output?.task_id;
  if (!taskId) throw new Error("听写任务没有返回任务编号。");
  return taskId;
}

async function pollAsrTask({ taskId, apiKey, baseUrl, timeoutMs, intervalMs = 2500, fetchImpl = fetch, signal }: {
  taskId: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<AsrTaskResponse> {
  const endpoint = `${nativeBaseUrl(baseUrl)}/tasks/${taskId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
    });
    const body = await response.json().catch(() => ({})) as AsrTaskResponse;
    const status = body.output?.task_status;
    if (status === "SUCCEEDED") return body;
    if (status === "FAILED") throw new Error(`听写任务失败：${body.output?.message || "未知原因"}`);
    await sleep(intervalMs);
  }
  throw new Error("听写任务超时，请稍后重试。");
}

export async function parseDiarizationTask(task: AsrTaskResponse, { apiKey, timeoutMs, fetchImpl = fetch, signal }: {
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<TranscriptLine[]> {
  const results = task.output?.results || [];
  const succeeded = results.find((result) => result.subtask_status === "SUCCEEDED" && result.transcription_url);
  if (!succeeded?.transcription_url) {
    const failed = results.find((result) => result.subtask_status === "FAILED");
    throw new Error(failed?.message || "听写任务没有成功结果。");
  }
  const response = await fetchImpl(succeeded.transcription_url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`听写结果下载失败：${response.status}`);
  const data = await response.json() as { transcripts?: Array<{ sentences?: Array<{ begin_time?: number; end_time?: number; text?: string; speaker_id?: number }> }> };
  const sentences = data.transcripts?.[0]?.sentences || [];
  return sentences
    .map((sentence) => ({
      startMs: Number(sentence.begin_time) || 0,
      endMs: Number(sentence.end_time) || 0,
      text: String(sentence.text || "").trim(),
      speaker: sentence.speaker_id !== undefined && sentence.speaker_id !== null ? String(sentence.speaker_id) : undefined
    }))
    .filter((line) => line.text);
}

function nativeBaseUrl(compatibleBaseUrl: string): string {
  const cleaned = String(compatibleBaseUrl || "").replace(/\/+$/, "");
  if (cleaned.includes("/compatible-mode/v1")) return cleaned.replace(/\/compatible-mode\/v1$/, "/api/v1");
  return "https://dashscope.aliyuncs.com/api/v1";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockTranscript(durationMs?: number): TranscriptLine[] {
  const duration = Math.max(1, durationMs || 30000);
  const snippets = [
    "这是一段临时演示听写，真实配置后会替换成视频里的声音。",
    "Koma 会把说话内容和画面放回同一条时间线上。",
    "你可以从关键瞬间开始回看，而不必重新观看完整视频。"
  ];
  return snippets.map((text, index) => {
    const startMs = Math.round((duration / snippets.length) * index);
    const endMs = Math.min(duration, Math.max(startMs, Math.round((duration / snippets.length) * (index + 1) - 300)));
    return { startMs, endMs, text };
  });
}

export function compactTranscriptText(value: string): string {
  return (value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([啊哦嗯哈诶哎呃唉喔噢呀嘿])\1{2,}/gu, "$1…")
    .replace(/([！!?？。])\1{2,}/gu, "$1");
}

interface FunAsrSyncResponse {
  output?: {
    output?: {
      sentence?: {
        text?: string;
        words?: Array<{ begin_time?: number; end_time?: number; text?: string; punctuation?: string }>;
      };
    };
    sentence?: {
      text?: string;
      words?: Array<{ begin_time?: number; end_time?: number; text?: string; punctuation?: string }>;
    };
    message?: string;
  };
  message?: string;
  code?: string;
}

interface OpenAITranscriptionResponse {
  text?: string;
  segments?: Array<{ start?: number; end?: number; text?: string }>;
  error?: { message?: string };
  message?: string;
}

interface AsrTaskResponse {
  output?: {
    task_status?: string;
    message?: string;
    results?: Array<{
      subtask_status?: string;
      transcription_url?: string;
      message?: string;
    }>;
  };
}
