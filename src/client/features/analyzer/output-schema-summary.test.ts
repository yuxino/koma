import { describe, expect, it } from "vitest";
import { attachFieldDescriptions, summarizeOutputSchema } from "./output-schema-summary.js";

describe("summarizeOutputSchema", () => {
  it("fails closed instead of overflowing on a maliciously deep browser draft", () => {
    const serialized = `${"[".repeat(5_000)}0${"]".repeat(5_000)}`;
    expect(summarizeOutputSchema(serialized, "en")).toEqual({ fields: [], total: 0 });
  });

  it("lists nested example leaves with stable array paths and localized meanings", () => {
    expect(summarizeOutputSchema(JSON.stringify({
      emotions: [{ label: "string", evidence: "string", startMs: 0, endMs: 0 }]
    }), "zh")).toEqual({
      fields: [
        { path: "emotions[].label", meaning: "情绪标签", type: "文本" },
        { path: "emotions[].evidence", meaning: "判断依据", type: "文本" },
        { path: "emotions[].startMs", meaning: "开始时间（毫秒）", type: "数字" },
        { path: "emotions[].endMs", meaning: "结束时间（毫秒）", type: "数字" }
      ],
      total: 4
    });
  });

  it("describes booleans, primitive arrays, and unknown lower-camel-case fields in English", () => {
    expect(summarizeOutputSchema(JSON.stringify({
      isSponsored: false,
      contentTags: ["string"],
      speakerMood: "string"
    }), "en")).toEqual({
      fields: [
        { path: "isSponsored", meaning: "Is sponsored", type: "Boolean" },
        { path: "contentTags[]", meaning: "Content tags", type: "Text" },
        { path: "speakerMood", meaning: "Speaker mood", type: "Text" }
      ],
      total: 3
    });
  });

  it("returns an empty summary for invalid JSON and caps visible fields without losing the total", () => {
    expect(summarizeOutputSchema("{bad json", "zh")).toEqual({ fields: [], total: 0 });

    const schema = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`field${index + 1}`, "string"]));
    const summary = summarizeOutputSchema(JSON.stringify(schema), "en", 4);
    expect(summary.fields).toHaveLength(4);
    expect(summary.total).toBe(10);
  });

  it("explains common compound business fields in Chinese", () => {
    expect(summarizeOutputSchema('{"overallSentiment":"string","isSponsored":false,"keyPeople":["string"],"firstAppearanceAtMs":0}', "zh").fields).toEqual([
      { path: "overallSentiment", meaning: "整体情感倾向", type: "文本" },
      { path: "isSponsored", meaning: "是否含商业推广", type: "是 / 否" },
      { path: "keyPeople[]", meaning: "关键人物", type: "文本" },
      { path: "firstAppearanceAtMs", meaning: "首次出现时间（毫秒）", type: "数字" }
    ]);
  });

  it("uses JSON Schema properties and descriptions when the editor contains a schema", () => {
    const schema = {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "视频中出现的商品名称" },
              price: { type: "number" }
            }
          }
        }
      }
    };

    expect(summarizeOutputSchema(JSON.stringify(schema), "zh").fields).toEqual([
      { path: "products[].name", meaning: "视频中出现的商品名称", type: "文本" },
      { path: "products[].price", meaning: "价格", type: "数字" }
    ]);
  });

  it("uses AI explanations only for matching paths and keeps structural fallbacks for manual fields", () => {
    const summary = summarizeOutputSchema('{"plates":[{"plateNumber":"string","city":"string","confidence":0}]}', "zh");

    expect(attachFieldDescriptions(summary, [
      { path: "plates[].plateNumber", label: "车牌号码", description: "视频中识别到的完整车牌号码", source: "request" },
      { path: "plates[].city", label: "所属城市", description: "根据车牌号码推断的城市", source: "request" },
      { path: "stale.path", label: "旧字段", description: "不应显示", source: "addition" }
    ]).fields).toEqual([
      { path: "plates[].plateNumber", meaning: "plateNumber", type: "文本", label: "车牌号码", description: "视频中识别到的完整车牌号码", source: "request" },
      { path: "plates[].city", meaning: "city", type: "文本", label: "所属城市", description: "根据车牌号码推断的城市", source: "request" },
      { path: "plates[].confidence", meaning: "置信度", type: "数字", label: "置信度" }
    ]);
  });
});
