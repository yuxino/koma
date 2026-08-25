import { describe, expect, it } from "vitest";
import { summarizeOutputSchema } from "./output-schema-summary.js";

describe("summarizeOutputSchema", () => {
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
});
