import { describe, expect, it } from "vitest";
import { translateTagCategory } from "./analysis-labels.js";

describe("translateTagCategory", () => {
  it.each([
    ["主体", "Subject"], ["场景", "Scene"], ["动作", "Action"],
    ["主题", "Topic"], ["氛围", "Mood"], ["形式", "Format"]
  ])("translates the known category %s only for English display", (category, english) => {
    expect(translateTagCategory(category, "en")).toBe(english);
    expect(translateTagCategory(category, "zh")).toBe(category);
  });

  it("preserves unknown, already-English, and empty category values", () => {
    for (const category of ["Product", "自定义分类", "", "  场景  ", "__proto__", "constructor"]) {
      expect(translateTagCategory(category, "en")).toBe(category);
      expect(translateTagCategory(category, "zh")).toBe(category);
    }
  });
});
