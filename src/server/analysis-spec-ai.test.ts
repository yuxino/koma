import { describe, expect, it } from "vitest";
import {
  AnalysisSpecAiError,
  generateAnalysisSpec,
  parseGeneratedAnalysisSpec,
  validateAnalysisSpecGenerationInstruction,
  validateAnalysisSpecGenerationLanguage
} from "./analysis-spec-ai.js";
import type { ChatCompletionRequest } from "./chat-completion.js";
import type { RuntimeProvider } from "./provider-runtime.js";
import type { VisionProvider } from "./config.js";

const provider: RuntimeProvider<VisionProvider> = {
  provider: "openai",
  apiKey: "secret",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini"
};

describe("parseGeneratedAnalysisSpec", () => {
  it("accepts a valid generated JSON shape", () => {
    expect(parseGeneratedAnalysisSpec('{"outputSchema":{"items":[{"name":"string","atMs":0}]}}')).toEqual({
      outputSchema: { items: [{ name: "string", atMs: 0 }] }
    });
  });

  it("accepts JSON inside a markdown fence", () => {
    expect(parseGeneratedAnalysisSpec('```json\n{"outputSchema":{"people":[{"displayName":"string"}]}}\n```')).toEqual({
      outputSchema: { people: [{ displayName: "string" }] }
    });
  });

  it("joins provider content arrays before parsing", () => {
    expect(parseGeneratedAnalysisSpec([
      { type: "text", text: '{"outputSchema":{"items":' },
      { type: "text", text: '[{"name":"string"}]}}' }
    ])).toEqual({ outputSchema: { items: [{ name: "string" }] } });
  });

  it("rejects missing outputSchema and scalar roots as invalid upstream output", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"items":[]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('"string"'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":"string"}'));
  });

  it("rejects over-complex shapes through parseAnalysisSpec", () => {
    let shape: unknown = {};
    for (let index = 0; index < 34; index += 1) shape = { nested: shape };
    expectInvalidOutput(() => parseGeneratedAnalysisSpec(JSON.stringify({ outputSchema: shape })));
  });

  it("requires lower-camel-case keys throughout the generated shape", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"display_name":"string"}}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"DisplayName":"string"}}'));
  });
});

describe("generateAnalysisSpec", () => {
  it("preserves the untrusted request and asks for placeholders, not invented values", async () => {
    const instruction = "  提取人物、商品和时间点，不要改写我的要求。\n";
    let captured: ChatCompletionRequest | undefined;
    const result = await generateAnalysisSpec({ instruction, provider }, {
      requestChatCompletion: async (request) => {
        captured = request;
        return '{"outputSchema":{"people":[{"displayName":"string"}],"atMs":0}}';
      }
    });

    expect(result).toEqual({ outputSchema: { people: [{ displayName: "string" }], atMs: 0 } });
    expect(captured?.userContent).toContain(instruction);
    expect(captured?.userContent).toContain("不可信数据");
    expect(captured?.userContent).toContain("lowerCamelCase");
    expect(captured?.userContent).toContain('字符串使用 "string"');
  });

  it("returns 503 for mock or incomplete providers", async () => {
    await expect(generateAnalysisSpec({ instruction: "提取人物", provider: { provider: "mock", apiKey: "", baseUrl: "", model: "" } }))
      .rejects.toMatchObject({ statusCode: 503 });
    await expect(generateAnalysisSpec({ instruction: "提取人物", provider: { ...provider, apiKey: "" } }))
      .rejects.toMatchObject({ statusCode: 503 });
  });

  it("maps provider failures to a sanitized 502 error", async () => {
    const error = await generateAnalysisSpec({ instruction: "提取人物", provider }, {
      requestChatCompletion: async () => { throw new Error("network internals and secret"); }
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalysisSpecAiError);
    expect(error).toMatchObject({ statusCode: 502, kind: "upstream" });
    expect((error as Error).message).not.toContain("network internals");
  });

  it("validates the user request with a 400 status before generation", () => {
    expect(() => validateAnalysisSpecGenerationInstruction(undefined)).toThrowError(AnalysisSpecAiError);
    try {
      validateAnalysisSpecGenerationInstruction(" ");
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400, kind: "request" });
    }
    expect(() => validateAnalysisSpecGenerationInstruction("a".repeat(4_001))).toThrow("最多 4000");
  });

  it("accepts only the documented optional interface language", () => {
    expect(validateAnalysisSpecGenerationLanguage(undefined)).toBeUndefined();
    expect(validateAnalysisSpecGenerationLanguage("en")).toBe("en");
    expect(validateAnalysisSpecGenerationLanguage("zh")).toBe("zh");
    expect(() => validateAnalysisSpecGenerationLanguage("ja")).toThrowError(AnalysisSpecAiError);
  });
});

function expectInvalidOutput(run: () => unknown): void {
  try {
    run();
    throw new Error("expected invalid output");
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisSpecAiError);
    expect(error).toMatchObject({ statusCode: 502, kind: "invalid-output" });
  }
}
