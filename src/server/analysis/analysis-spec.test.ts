import { describe, expect, it } from "vitest";
import { assertMatchesOutputShape, hasCustomAnalysis, parseAnalysisSpec } from "./analysis-spec.js";

describe("parseAnalysisSpec", () => {
  it("normalizes an instruction and JSON string shape", () => {
    const spec = parseAnalysisSpec({
      instruction: "  提取商品和价格  ",
      outputSchema: '{"products":[{"name":"string","price":0}]}',
      artifactFormats: '["json","csv","json"]'
    });
    expect(spec).toEqual({
      instruction: "提取商品和价格",
      outputSchema: { products: [{ name: "string", price: 0 }] },
      artifactFormats: ["json", "csv"]
    });
    expect(hasCustomAnalysis(spec)).toBe(true);
  });

  it("accepts an object from the JSON API", () => {
    expect(parseAnalysisSpec({ outputSchema: { sentiment: "positive|neutral|negative" } })).toEqual({
      outputSchema: { sentiment: "positive|neutral|negative" }
    });
  });

  it("drops blank optional fields", () => {
    const spec = parseAnalysisSpec({ instruction: "  ", outputSchema: "" });
    expect(spec).toEqual({});
    expect(hasCustomAnalysis(spec)).toBe(false);
  });

  it("rejects invalid or scalar JSON shapes", () => {
    expect(() => parseAnalysisSpec({ outputSchema: "{" })).toThrow("不是有效 JSON");
    expect(() => parseAnalysisSpec({ outputSchema: '"name"' })).toThrow("对象或数组");
  });

  it("rejects oversized instructions", () => {
    expect(() => parseAnalysisSpec({ instruction: "a".repeat(4_001) })).toThrow("最多 4000");
  });

  it("rejects excessively nested shapes", () => {
    let shape: unknown = {};
    for (let index = 0; index < 34; index += 1) shape = { nested: shape };
    expect(() => parseAnalysisSpec({ outputSchema: shape })).toThrow("过于复杂");
  });

  it("accepts comma-separated artifact formats and rejects unsupported formats", () => {
    expect(parseAnalysisSpec({ artifactFormats: "json,srt,markdown" }).artifactFormats).toEqual(["json", "srt", "markdown"]);
    expect(() => parseAnalysisSpec({ artifactFormats: ["pdf"] })).toThrow("不支持的输出文件格式");
  });
});

describe("assertMatchesOutputShape", () => {
  it("validates exact fields and nesting from a JSON example", () => {
    const shape = { products: [{ name: "string", price: "number" }] };
    expect(() => assertMatchesOutputShape({ products: [{ name: "咖啡", price: 18.5 }] }, shape)).not.toThrow();
    expect(() => assertMatchesOutputShape({ products: [{ name: "咖啡" }] }, shape)).toThrow("price 缺失");
    expect(() => assertMatchesOutputShape({ products: [], extra: true }, shape)).toThrow("不在目标结构中");
  });

  it("validates common JSON Schema constraints", () => {
    const schema = {
      type: "object",
      required: ["sentiment"],
      additionalProperties: false,
      properties: { sentiment: { type: "string", enum: ["positive", "neutral", "negative"] } }
    };
    expect(() => assertMatchesOutputShape({ sentiment: "positive" }, schema)).not.toThrow();
    expect(() => assertMatchesOutputShape({}, schema)).toThrow("sentiment 缺失");
    expect(() => assertMatchesOutputShape({ sentiment: "unknown" }, schema)).toThrow("允许值");
  });
});
