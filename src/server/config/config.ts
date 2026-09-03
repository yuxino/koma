import os from "node:os";
import "dotenv/config";

export type AsrProvider = "mock" | "dashscope" | "groq" | "openai" | "openai-compatible";
export type VisionProvider = "mock" | "dashscope" | "openai" | "gemini" | "openrouter" | "groq" | "openai-compatible";

export interface ProviderPreset {
  baseUrl: string;
  model: string;
  keyEnv: string;
}

export const asrProviderPresets: Record<Exclude<AsrProvider, "mock">, ProviderPreset> = {
  dashscope: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "fun-asr-flash-2026-06-15",
    keyEnv: "DASHSCOPE_API_KEY"
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
    keyEnv: "GROQ_API_KEY"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
    keyEnv: "OPENAI_API_KEY"
  },
  "openai-compatible": {
    baseUrl: "",
    model: "whisper-1",
    keyEnv: "ASR_API_KEY"
  }
};

export const visionProviderPresets: Record<Exclude<VisionProvider, "mock">, ProviderPreset> = {
  dashscope: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3-vl-flash",
    keyEnv: "DASHSCOPE_API_KEY"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    keyEnv: "OPENAI_API_KEY"
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    keyEnv: "GEMINI_API_KEY"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    keyEnv: "OPENROUTER_API_KEY"
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    keyEnv: "GROQ_API_KEY"
  },
  "openai-compatible": {
    baseUrl: "",
    model: "",
    keyEnv: "VISION_API_KEY"
  }
};

const dashscopeApiKey = process.env.DASHSCOPE_API_KEY || "";
const dashscopeWorkspaceId = process.env.DASHSCOPE_WORKSPACE_ID || "";
const dashscopeBaseUrl = process.env.DASHSCOPE_BASE_URL
  || (dashscopeWorkspaceId
    ? `https://${dashscopeWorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`
    : visionProviderPresets.dashscope.baseUrl);
const requestedAsrProvider = normalizeProvider<AsrProvider>(
  process.env.ASR_PROVIDER,
  ["mock", "dashscope", "groq", "openai", "openai-compatible"],
  dashscopeApiKey ? "dashscope" : "mock"
);
// ANALYSIS_PROVIDER 是 0.1 版变量，继续接受它以免旧部署升级后失效。
const legacyVisionProvider = process.env.ANALYSIS_PROVIDER === "openai-compatible" ? "openai-compatible" : process.env.ANALYSIS_PROVIDER;
const requestedVisionProvider = normalizeProvider<VisionProvider>(
  process.env.VISION_PROVIDER || legacyVisionProvider,
  ["mock", "dashscope", "openai", "gemini", "openrouter", "groq", "openai-compatible"],
  dashscopeApiKey ? "dashscope" : "mock"
);
const requestedDiarization = process.env.ASR_DIARIZATION;
const asrPreset = requestedAsrProvider === "mock" ? undefined : asrProviderPresets[requestedAsrProvider];
const visionPreset = requestedVisionProvider === "mock" ? undefined : visionProviderPresets[requestedVisionProvider];
const asrApiKey = process.env.ASR_API_KEY || providerKey(requestedAsrProvider, asrPreset?.keyEnv);
// 0.1 版把 DashScope 当作 openai-compatible 使用，只有在自定义 Key/Base URL
// 都未填写时才启用该回退，避免把 DashScope Key 误发给其他兼容服务。
const legacyDashscopeVision = requestedVisionProvider === "openai-compatible"
  && !process.env.VISION_API_KEY
  && !process.env.VISION_BASE_URL
  && Boolean(dashscopeApiKey);
const visionApiKey = process.env.VISION_API_KEY
  || (legacyDashscopeVision ? dashscopeApiKey : providerKey(requestedVisionProvider, visionPreset?.keyEnv));

const integerEnv = (name: string, fallback: number): number => {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const nonNegativeIntegerEnv = (name: string, fallback: number): number => {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const floatEnv = (name: string, fallback: number, min: number, max: number): number => {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

const booleanEnv = (name: string, fallback = false): boolean => {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(value)) return true;
  if (["0", "false", "off", "no"].includes(value)) return false;
  return fallback;
};

export function resolveProvider<T extends string>(rawProvider: T, hasKey: boolean): T | "mock" {
  return rawProvider !== "mock" && !hasKey ? "mock" : rawProvider;
}

export function normalizeProvider<T extends string>(rawProvider: string | undefined, supported: readonly T[], fallback: T): T {
  const value = String(rawProvider || "").trim().toLowerCase() as T;
  return value && supported.includes(value) ? value : fallback;
}

function providerKey(provider: AsrProvider | VisionProvider, keyEnv?: string): string {
  if (provider === "mock" || !keyEnv) return "";
  return process.env[keyEnv] || "";
}

export const config = {
  port: integerEnv("PORT", 3000),
  trustProxy: booleanEnv("TRUST_PROXY"),
  // 0 表示关闭。公开演示建议设为 3～10，按来源 IP 和 UTC 日期限流。
  demoRequestsPerIpPerDay: nonNegativeIntegerEnv("DEMO_REQUESTS_PER_IP_PER_DAY", 0),
  maxUploadBytes: integerEnv("MAX_UPLOAD_BYTES", 500 * 1024 * 1024),
  maxDurationSeconds: integerEnv("MAX_DURATION_SECONDS", 15 * 60),
  frameWidth: integerEnv("FRAME_WIDTH", 1280),
  frameSceneThreshold: floatEnv("FRAME_SCENE_THRESHOLD", 0.4, 0.05, 0.95),
  maxFrames: integerEnv("MAX_FRAMES", 18),
  // Provider 自身的图片数量限制在发起请求时按实际任务快照处理。
  visionMaxFrames: integerEnv("VISION_MAX_FRAMES", 10),
  visionTranscriptChars: integerEnv("VISION_TRANSCRIPT_CHARS", 30000),
  visionMaxTokens: integerEnv("VISION_MAX_TOKENS", 2000),
  // File artifacts need more room than the summary JSON; only used when formats are explicitly requested.
  artifactMaxTokens: integerEnv("ARTIFACT_MAX_TOKENS", 6000),
  maxConcurrentJobs: integerEnv("MAX_CONCURRENT_JOBS", 2),
  tempRoot: process.env.TEMP_ROOT || os.tmpdir(),
  asrProvider: resolveProvider(requestedAsrProvider, Boolean(asrApiKey)) as AsrProvider,
  visionProvider: resolveProvider(requestedVisionProvider, Boolean(visionApiKey)) as VisionProvider,
  // 兼容旧代码/旧健康检查字段；新代码统一使用 visionProvider。
  analysisProvider: resolveProvider(requestedVisionProvider, Boolean(visionApiKey)) as VisionProvider,
  asrApiKey,
  asrBaseUrl: process.env.ASR_BASE_URL || (requestedAsrProvider === "dashscope" ? dashscopeBaseUrl : asrPreset?.baseUrl || ""),
  asrModel: process.env.ASR_MODEL || asrPreset?.model || "",
  asrSegmentSeconds: integerEnv("ASR_SEGMENT_SECONDS", 60),
  asrMaxSegmentBytes: integerEnv("ASR_MAX_SEGMENT_BYTES", 8 * 1024 * 1024),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, ""),
  asrDiarization: requestedDiarization === "on" ? true : requestedDiarization === "off" ? false : Boolean(process.env.PUBLIC_BASE_URL),
  aiTimeoutMs: integerEnv("AI_TIMEOUT_MS", integerEnv("DASHSCOPE_TIMEOUT_MS", 120000)),
  visionApiKey,
  visionBaseUrl: process.env.VISION_BASE_URL || (requestedVisionProvider === "dashscope" || legacyDashscopeVision ? dashscopeBaseUrl : visionPreset?.baseUrl || ""),
  visionModel: process.env.VISION_MODEL || (legacyDashscopeVision ? visionProviderPresets.dashscope.model : visionPreset?.model || ""),
  dashscopeApiKey,
  dashscopeWorkspaceId,
  dashscopeBaseUrl,
  // 旧字段保留一个版本，方便现有部署平滑升级。
  dashscopeModel: process.env.ASR_MODEL || asrProviderPresets.dashscope.model,
  dashscopeTimeoutMs: integerEnv("AI_TIMEOUT_MS", integerEnv("DASHSCOPE_TIMEOUT_MS", 120000))
} as const;

if (config.asrProvider === "mock" && requestedAsrProvider !== "mock") {
  console.warn(`[koma] 已声明 ASR_PROVIDER=${requestedAsrProvider} 但缺少 ${asrPreset?.keyEnv || "API Key"}，自动改用演示听写。`);
}
if (config.visionProvider === "mock" && requestedVisionProvider !== "mock") {
  console.warn(`[koma] 已声明 VISION_PROVIDER=${requestedVisionProvider} 但缺少 ${visionPreset?.keyEnv || "API Key"}，自动改用演示画面分析。`);
}

export function asrIsConfigured(): boolean {
  return config.asrProvider !== "mock" && Boolean(config.asrApiKey);
}

export function analysisIsConfigured(): boolean {
  return config.visionProvider !== "mock" && Boolean(config.visionApiKey);
}
