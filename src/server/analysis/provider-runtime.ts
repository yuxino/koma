import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import {
  asrProviderPresets,
  config,
  visionProviderPresets,
  type AsrProvider,
  type ProviderPreset,
  type VisionProvider
} from "../config/config.js";
import { readSetting, writeSetting } from "../persistence/database.js";

export interface RuntimeProvider<TProvider extends string> {
  provider: TProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface RuntimeProviders {
  asr: RuntimeProvider<AsrProvider>;
  vision: RuntimeProvider<VisionProvider>;
}

export interface ProviderSettingsInput {
  asr?: ProviderStageInput;
  vision?: ProviderStageInput;
}

export interface ProviderStageInput {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
}

interface StoredProviderSettings {
  version: 1;
  updatedAt: number;
  source?: "environment" | "admin";
  providers: RuntimeProviders;
}

interface EncryptedEnvelope {
  version: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

const asrProviders = ["mock", "dashscope", "groq", "openai", "openai-compatible"] as const;
const visionProviders = ["mock", "dashscope", "openai", "gemini", "openrouter", "groq", "openai-compatible"] as const;
const environmentProviders = Object.freeze<RuntimeProviders>({
  asr: Object.freeze({ provider: config.asrProvider, apiKey: config.asrApiKey, baseUrl: config.asrBaseUrl, model: config.asrModel }),
  vision: Object.freeze({ provider: config.visionProvider, apiKey: config.visionApiKey, baseUrl: config.visionBaseUrl, model: config.visionModel })
});

let activeProviders: RuntimeProviders = cloneProviders(environmentProviders);
let settingsSource: "environment" | "admin" = "environment";
let settingsUpdatedAt: number | null = null;

export function adminSettingsEnabled(): boolean {
  return Boolean(adminPassword());
}

export async function initializeProviderSettings(): Promise<void> {
  if (!adminSettingsEnabled()) return;
  try {
    const raw = await readSetting("provider_settings");
    if (!raw) return;
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    const stored = decryptSettings(envelope, encryptionSecret());
    activeProviders = validateStoredProviders(stored.providers);
    settingsSource = stored.source === "environment" ? "environment" : "admin";
    settingsUpdatedAt = stored.updatedAt;
  } catch (error) {
    console.warn(`[koma] 无法读取后台 Provider 配置，继续使用环境变量：${error instanceof Error ? error.message : String(error)}`);
  }
}

export function getRuntimeProviders(): RuntimeProviders {
  return cloneProviders(activeProviders);
}

export function getSafeProviderSettings() {
  return {
    source: settingsSource,
    updatedAt: settingsUpdatedAt,
    providers: {
      asr: safeStage(activeProviders.asr),
      vision: safeStage(activeProviders.vision)
    },
    options: {
      asr: asrProviders,
      vision: visionProviders
    },
    presets: {
      asr: safePresets("asr", asrProviders),
      vision: safePresets("vision", visionProviders)
    }
  };
}

export async function updateProviderSettings(input: ProviderSettingsInput): Promise<ReturnType<typeof getSafeProviderSettings>> {
  if (!adminSettingsEnabled()) throw new Error("管理后台尚未启用，请先配置 ADMIN_PASSWORD。");
  if (!input || typeof input !== "object") throw new Error("Provider 配置不能为空。");
  const next: RuntimeProviders = {
    asr: input.asr ? normalizeStage("asr", input.asr, activeProviders.asr) : { ...activeProviders.asr },
    vision: input.vision ? normalizeStage("vision", input.vision, activeProviders.vision) : { ...activeProviders.vision }
  };
  const updatedAt = Date.now();
  await persistSettings({ version: 1, updatedAt, source: "admin", providers: next });
  activeProviders = next;
  settingsSource = "admin";
  settingsUpdatedAt = updatedAt;
  return getSafeProviderSettings();
}

export async function resetProviderSettings(): Promise<ReturnType<typeof getSafeProviderSettings>> {
  if (!adminSettingsEnabled()) throw new Error("管理后台尚未启用，请先配置 ADMIN_PASSWORD。");
  const next = cloneProviders(environmentProviders);
  const updatedAt = Date.now();
  await persistSettings({ version: 1, updatedAt, source: "environment", providers: next });
  activeProviders = next;
  settingsSource = "environment";
  settingsUpdatedAt = updatedAt;
  return getSafeProviderSettings();
}

export function providerLabel(stage: RuntimeProvider<string>): string {
  return stage.provider === "mock" ? "mock" : `${stage.provider} · ${stage.model}`;
}

function normalizeStage(stage: "asr", input: ProviderStageInput, current: RuntimeProvider<AsrProvider>): RuntimeProvider<AsrProvider>;
function normalizeStage(stage: "vision", input: ProviderStageInput, current: RuntimeProvider<VisionProvider>): RuntimeProvider<VisionProvider>;
function normalizeStage(stage: "asr" | "vision", input: ProviderStageInput, current: RuntimeProvider<AsrProvider | VisionProvider>): RuntimeProvider<AsrProvider | VisionProvider> {
  const supported = stage === "asr" ? asrProviders : visionProviders;
  const provider = cleanString(input.provider ?? current.provider, "Provider", 64).toLowerCase() as AsrProvider | VisionProvider;
  if (!(supported as readonly string[]).includes(provider)) throw new Error(`不支持的 ${stage.toUpperCase()} Provider：${provider}`);
  if (provider === "mock") return { provider, apiKey: "", baseUrl: "", model: "" };

  const changedProvider = provider !== current.provider;
  const preset = providerPreset(stage, provider);
  const submittedKey = optionalString(input.apiKey, "API Key", 2048);
  const apiKey = submittedKey || (!changedProvider ? current.apiKey : environmentKey(preset));
  const baseUrl = optionalString(input.baseUrl, "Base URL", 1000) || (!changedProvider ? current.baseUrl : preset?.baseUrl || "");
  const model = optionalString(input.model, "模型", 300) || (!changedProvider ? current.model : preset?.model || "");
  if (!apiKey) throw new Error(`${stage.toUpperCase()} Provider=${provider} 需要 API Key。`);
  if (!baseUrl) throw new Error(`${stage.toUpperCase()} Provider=${provider} 需要 Base URL。`);
  if (!model) throw new Error(`${stage.toUpperCase()} Provider=${provider} 需要模型名称。`);
  validateBaseUrl(baseUrl);
  return { provider, apiKey, baseUrl: baseUrl.replace(/\/+$/, ""), model };
}

function validateStoredProviders(value: RuntimeProviders): RuntimeProviders {
  if (!value || typeof value !== "object") throw new Error("后台配置格式无效。");
  return {
    asr: normalizeStage("asr", value.asr, environmentProviders.asr),
    vision: normalizeStage("vision", value.vision, environmentProviders.vision)
  };
}

function providerPreset(stage: "asr" | "vision", provider: AsrProvider | VisionProvider): ProviderPreset | undefined {
  if (provider === "mock") return undefined;
  return stage === "asr"
    ? asrProviderPresets[provider as Exclude<AsrProvider, "mock">]
    : visionProviderPresets[provider as Exclude<VisionProvider, "mock">];
}

function environmentKey(preset: ProviderPreset | undefined): string {
  return preset ? String(process.env[preset.keyEnv] || "").trim() : "";
}

function safeStage(stage: RuntimeProvider<string>) {
  return {
    provider: stage.provider,
    baseUrl: stage.baseUrl,
    model: stage.model,
    keyConfigured: Boolean(stage.apiKey),
    keyHint: stage.apiKey ? `••••${stage.apiKey.slice(-4)}` : null
  };
}

function safePresets(stage: "asr" | "vision", providers: readonly (AsrProvider | VisionProvider)[]) {
  return Object.fromEntries(providers.map((provider) => {
    const preset = providerPreset(stage, provider);
    return [provider, { baseUrl: preset?.baseUrl || "", model: preset?.model || "" }];
  }));
}

function validateBaseUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Base URL 不是有效网址。");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Base URL 只支持 http 或 https。");
}

function cleanString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串。`);
  const result = value.trim();
  if (!result) throw new Error(`${label} 不能为空。`);
  if (result.length > maxLength) throw new Error(`${label} 过长。`);
  return result;
}

function optionalString(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null || value === "") return "";
  return cleanString(value, label, maxLength);
}

function cloneProviders(value: RuntimeProviders): RuntimeProviders {
  return { asr: { ...value.asr }, vision: { ...value.vision } };
}

function adminPassword(): string {
  return String(process.env.ADMIN_PASSWORD || "");
}

function encryptionSecret(): string {
  return String(process.env.KOMA_CONFIG_SECRET || adminPassword());
}

async function persistSettings(settings: StoredProviderSettings): Promise<void> {
  await writeSetting("provider_settings", JSON.stringify(encryptSettings(settings, encryptionSecret())));
}

export function encryptSettings(settings: StoredProviderSettings, secret: string): EncryptedEnvelope {
  if (!secret) throw new Error("缺少 Provider 配置加密密钥。");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
  return { version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

export function decryptSettings(envelope: EncryptedEnvelope, secret: string): StoredProviderSettings {
  if (!secret || envelope?.version !== 1) throw new Error("Provider 配置文件版本无效。");
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const key = scryptSync(secret, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
  const settings = JSON.parse(plaintext) as StoredProviderSettings;
  if (settings?.version !== 1 || !settings.providers) throw new Error("Provider 配置内容无效。");
  return settings;
}
