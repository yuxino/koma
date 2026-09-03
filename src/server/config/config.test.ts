import { describe, expect, it } from "vitest";
import { asrProviderPresets, normalizeProvider, resolveProvider, visionProviderPresets } from "./config.js";

describe("provider resolution", () => {
  it("keeps an explicitly configured real provider when a key exists", () => {
    expect(resolveProvider("dashscope", true)).toBe("dashscope");
    expect(resolveProvider("openai-compatible", true)).toBe("openai-compatible");
  });

  it("falls back to mock when a real provider is requested without a key", () => {
    expect(resolveProvider("dashscope", false)).toBe("mock");
    expect(resolveProvider("openai-compatible", false)).toBe("mock");
  });

  it("keeps mock and unknown values as-is so misconfiguration still surfaces later", () => {
    expect(resolveProvider("mock", false)).toBe("mock");
    expect(resolveProvider("something-else", true)).toBe("something-else");
  });

  it("ships useful presets without locking users to Qwen", () => {
    expect(asrProviderPresets.groq).toMatchObject({ model: "whisper-large-v3-turbo", keyEnv: "GROQ_API_KEY" });
    expect(visionProviderPresets.openrouter).toMatchObject({ model: "openrouter/free", keyEnv: "OPENROUTER_API_KEY" });
    expect(visionProviderPresets.gemini.baseUrl).toContain("generativelanguage.googleapis.com");
  });

  it("normalizes provider names and uses a fallback for unsupported values", () => {
    expect(normalizeProvider("GROQ", ["mock", "groq"] as const, "mock")).toBe("groq");
    expect(normalizeProvider("typo", ["mock", "groq"] as const, "mock")).toBe("mock");
  });
});
