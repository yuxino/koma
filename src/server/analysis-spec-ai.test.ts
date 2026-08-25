import { describe, expect, it } from "vitest";
import {
  AnalysisSpecAiError,
  generateAnalysisSpec,
  parseGeneratedAnalysisSpec,
  validateAnalysisSpecGenerationInstruction,
  validateAnalysisSpecGenerationLanguage,
  validateAnalysisSpecGenerationRequest
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
    expect(parseGeneratedAnalysisSpec('{"outputSchema":{"items":[{"name":"string","atMs":0}]},"fieldDescriptions":[{"path":"items[].name","label":"商品名称","description":"视频中识别到的商品名称","source":"request"},{"path":"items[].atMs","label":"出现时间","description":"商品第一次出现在视频中的时间，单位为毫秒","source":"addition"}]}')).toEqual({
      outputSchema: { items: [{ name: "string", atMs: 0 }] },
      fieldDescriptions: [
        { path: "items[].name", label: "商品名称", description: "视频中识别到的商品名称", source: "request" },
        { path: "items[].atMs", label: "出现时间", description: "商品第一次出现在视频中的时间，单位为毫秒", source: "addition" }
      ]
    });
  });

  it("accepts JSON inside a markdown fence", () => {
    expect(parseGeneratedAnalysisSpec('```json\n{"outputSchema":{"people":[{"displayName":"string"}]},"fieldDescriptions":[{"path":"people[].displayName","label":"人物姓名","description":"视频中出现人物的姓名或称呼","source":"request"}]}\n```')).toEqual({
      outputSchema: { people: [{ displayName: "string" }] },
      fieldDescriptions: [{ path: "people[].displayName", label: "人物姓名", description: "视频中出现人物的姓名或称呼", source: "request" }]
    });
  });

  it("joins provider content arrays before parsing", () => {
    expect(parseGeneratedAnalysisSpec([
      { type: "text", text: '{"outputSchema":{"items":' },
      { type: "text", text: '[{"name":"string"}]},"fieldDescriptions":[{"path":"items[].name","label":"Name","description":"The item name shown in the video","source":"request"}]}' }
    ])).toEqual({
      outputSchema: { items: [{ name: "string" }] },
      fieldDescriptions: [{ path: "items[].name", label: "Name", description: "The item name shown in the video", source: "request" }]
    });
  });

  it("rejects missing outputSchema and scalar roots as invalid upstream output", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"items":[]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('"string"'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":"string","fieldDescriptions":[]}'));
  });

  it("rejects over-complex shapes through parseAnalysisSpec", () => {
    let shape: unknown = {};
    for (let index = 0; index < 34; index += 1) shape = { nested: shape };
    expectInvalidOutput(() => parseGeneratedAnalysisSpec(JSON.stringify({ outputSchema: shape, fieldDescriptions: [] })));
  });

  it("requires lower-camel-case keys throughout the generated shape", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"display_name":"string"},"fieldDescriptions":[]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"DisplayName":"string"},"fieldDescriptions":[]}'));
  });

  it("requires exactly one description for every schema leaf", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"plateNumber":"string","province":"string"},"fieldDescriptions":[{"path":"plateNumber","label":"车牌号","description":"识别到的完整车牌号码","source":"request"}]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"plateNumber":"string"},"fieldDescriptions":[{"path":"plateNumber","label":"车牌号","description":"识别到的完整车牌号码","source":"request"},{"path":"plateNumber","label":"号码","description":"重复说明","source":"request"}]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"plateNumber":"string"},"fieldDescriptions":[{"path":"unknown","label":"未知","description":"不存在的字段","source":"request"}]}'));
  });

  it("rejects empty explanations and unknown origins", () => {
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"plateNumber":"string"},"fieldDescriptions":[{"path":"plateNumber","label":"","description":"识别到的完整车牌号码","source":"request"}]}'));
    expectInvalidOutput(() => parseGeneratedAnalysisSpec('{"outputSchema":{"plateNumber":"string"},"fieldDescriptions":[{"path":"plateNumber","label":"车牌号","description":"识别到的完整车牌号码","source":"model"}]}'));
  });
});

describe("generateAnalysisSpec", () => {
  it("preserves the untrusted request and asks for placeholders, not invented values", async () => {
    const instruction = "  识别车牌号、省份和城市，不要改写我的要求。\n";
    let captured: ChatCompletionRequest | undefined;
    const result = await generateAnalysisSpec({
      instruction,
      additions: ["为用户要求的字段补充依据和首次出现时间。"],
      language: "zh",
      provider
    }, {
      requestChatCompletion: async (request) => {
        captured = request;
        return '{"outputSchema":{"plates":[{"plateNumber":"string","province":"string","city":"string","evidence":"string","atMs":0}]},"fieldDescriptions":[{"path":"plates[].plateNumber","label":"车牌号码","description":"从视频画面中识别到的完整车牌号码","source":"request"},{"path":"plates[].province","label":"登记省份","description":"根据车牌简称判断的车辆登记省份","source":"request"},{"path":"plates[].city","label":"登记城市","description":"根据车牌字母代码判断的车辆登记城市","source":"request"},{"path":"plates[].evidence","label":"判断依据","description":"支持车牌识别结果的画面文字或视觉依据","source":"addition"},{"path":"plates[].atMs","label":"首次出现时间","description":"该车牌首次出现在视频中的时间，单位为毫秒","source":"addition"}]}';
      }
    });

    expect(result.outputSchema).toEqual({ plates: [{ plateNumber: "string", province: "string", city: "string", evidence: "string", atMs: 0 }] });
    expect(result.fieldDescriptions).toHaveLength(5);
    expect(captured?.userContent).toContain(instruction);
    expect(captured?.userContent).toContain("为用户要求的字段补充依据和首次出现时间");
    expect(captured?.userContent).toContain("用户明确要求");
    expect(captured?.userContent).toContain("快速补充");
    expect(captured?.userContent).toContain("简体中文");
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

  it("keeps the primary request separate from optional quick additions", () => {
    expect(validateAnalysisSpecGenerationRequest("识别车牌", ["附上时间点", "  "])).toEqual({
      instruction: "识别车牌",
      additions: ["附上时间点"]
    });
    expect(validateAnalysisSpecGenerationRequest("", ["生成双语字幕"])).toEqual({
      instruction: "",
      additions: ["生成双语字幕"]
    });
    expect(() => validateAnalysisSpecGenerationRequest("", [])).toThrowError(AnalysisSpecAiError);
    expect(() => validateAnalysisSpecGenerationRequest("要求", "补充")).toThrowError(AnalysisSpecAiError);
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
