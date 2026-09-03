import { config } from "../config/config.js";
import type { RuntimeProvider } from "./provider-runtime.js";

export type ChatCompletionUserContent = string | readonly Record<string, unknown>[];
export type ChatCompletionContent = string | unknown[];

export interface ChatCompletionRequest {
  provider: RuntimeProvider<string>;
  userContent: ChatCompletionUserContent;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

export class ChatCompletionUpstreamError extends Error {
  readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number) {
    super(message);
    this.name = "ChatCompletionUpstreamError";
    this.upstreamStatus = upstreamStatus;
  }
}

/** Send one OpenAI-compatible chat completion without exposing provider secrets. */
export async function requestChatCompletion({
  provider,
  userContent,
  temperature,
  maxTokens,
  signal
}: ChatCompletionRequest): Promise<ChatCompletionContent> {
  const timeoutSignal = AbortSignal.timeout(config.aiTimeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(chatCompletionUrl(provider.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
      ...(provider.provider === "openrouter"
        ? { "HTTP-Referer": "https://github.com/yuxino/koma", "X-Title": "Koma" }
        : {})
    },
    body: JSON.stringify({
      model: provider.model,
      temperature,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userContent }]
    }),
    signal: requestSignal
  });
  const body = await response.json().catch(() => ({})) as ChatCompletionResponse;
  if (!response.ok) {
    throw new ChatCompletionUpstreamError(
      sanitizedUpstreamMessage(response.status, body, provider.apiKey),
      response.status
    );
  }
  const content = body.choices?.[0]?.message?.content;
  return typeof content === "string" || Array.isArray(content) ? content : "";
}

interface ChatCompletionResponse {
  error?: { message?: unknown };
  message?: unknown;
  choices?: Array<{ message?: { content?: unknown } }>;
}

function chatCompletionUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}/chat/completions`;
}

function sanitizedUpstreamMessage(status: number, body: ChatCompletionResponse, apiKey: string): string {
  const raw = typeof body.error?.message === "string"
    ? body.error.message
    : typeof body.message === "string" ? body.message : "";
  let safe = raw;
  if (apiKey) safe = safe.split(apiKey).join("[redacted]");
  safe = safe
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|key)-[A-Za-z0-9._-]{8,}\b/gi, "[redacted]")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
  return safe ? `模型请求失败（HTTP ${status}）：${safe}` : `模型请求失败（HTTP ${status}）。`;
}
