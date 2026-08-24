import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { ChatCompletionUpstreamError, requestChatCompletion } from "./chat-completion.js";
import type { RuntimeProvider } from "./provider-runtime.js";
import type { VisionProvider } from "./config.js";

const openRouterProvider: RuntimeProvider<VisionProvider> = {
  provider: "openrouter",
  apiKey: "openrouter-secret-key",
  baseUrl: "https://openrouter.ai/api/v1///",
  model: "openrouter/free"
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("requestChatCompletion", () => {
  it("normalizes the URL and sends provider authentication, headers, and model options", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "done" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestChatCompletion({
      provider: openRouterProvider,
      userContent: "hello",
      temperature: 0.35,
      maxTokens: 777
    })).resolves.toBe("done");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openrouter-secret-key",
      "content-type": "application/json",
      "HTTP-Referer": "https://github.com/yuxino/koma",
      "X-Title": "Koma"
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: "openrouter/free",
      temperature: 0.35,
      max_tokens: 777,
      messages: [{ role: "user", content: "hello" }]
    });
  });

  it("does not add OpenRouter attribution headers for other providers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    vi.stubGlobal("fetch", fetchMock);

    await requestChatCompletion({
      provider: { ...openRouterProvider, provider: "openai", baseUrl: "https://api.openai.com/v1" },
      userContent: "hello",
      temperature: 0.2,
      maxTokens: 100
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).not.toHaveProperty("HTTP-Referer");
    expect(init.headers).not.toHaveProperty("X-Title");
  });

  it("returns both string and array message content without changing it", async () => {
    const parts = [{ type: "text", text: "part one" }, { type: "text", text: "part two" }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "plain" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: parts } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const input = { provider: openRouterProvider, userContent: "hello", temperature: 0, maxTokens: 100 };
    await expect(requestChatCompletion(input)).resolves.toBe("plain");
    await expect(requestChatCompletion(input)).resolves.toEqual(parts);
  });

  it("combines a caller cancellation signal with the configured timeout", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return jsonResponse({ choices: [{ message: { content: "ok" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const controller = new AbortController();

    await requestChatCompletion({
      provider: openRouterProvider,
      userContent: [{ type: "text", text: "hello" }],
      temperature: 0.2,
      maxTokens: 100,
      signal: controller.signal
    });

    expect(timeoutSpy).toHaveBeenCalledWith(config.aiTimeoutMs);
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("sanitizes upstream failures without leaking credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      error: { message: "bad credential openrouter-secret-key\nBearer another-secret" }
    }, 401)));

    const error = await requestChatCompletion({
      provider: openRouterProvider,
      userContent: "hello",
      temperature: 0.2,
      maxTokens: 100
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ChatCompletionUpstreamError);
    expect((error as ChatCompletionUpstreamError).upstreamStatus).toBe(401);
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("openrouter-secret-key");
    expect((error as Error).message).not.toContain("another-secret");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
