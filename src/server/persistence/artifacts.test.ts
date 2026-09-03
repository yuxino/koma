import { describe, expect, it } from "vitest";
import { contentDisposition, missingArtifactFormats, normalizeArtifacts } from "./artifacts.js";

describe("artifact normalization", () => {
  it("normalizes file names, MIME types, JSON content, and language", () => {
    const artifacts = normalizeArtifacts([
      { name: "../zh-CN", format: "json", language: "zh-CN", content: { hello: "你好" } },
      { name: "subtitles.srt", content: "1\n00:00:00,000 --> 00:00:01,000\nHello" }
    ]);
    expect(artifacts[0]).toMatchObject({ id: "0", name: "zh-CN.json", format: "json", language: "zh-CN" });
    expect(artifacts[0].mimeType).toContain("application/json");
    expect(artifacts[0].content).toContain('"hello": "你好"');
    expect(artifacts[1]).toMatchObject({ name: "subtitles.srt", format: "srt" });
  });

  it("rejects invalid JSON artifacts", () => {
    expect(() => normalizeArtifacts([{ name: "bad.json", content: "{" }])).toThrow("不是有效 JSON");
  });

  it("reports requested formats that were not generated", () => {
    const artifacts = normalizeArtifacts([{ name: "report.md", content: "# Report" }]);
    expect(missingArtifactFormats(artifacts, ["markdown", "csv"])).toEqual(["csv"]);
  });

  it("builds a safe content-disposition header", () => {
    const header = contentDisposition("中文字幕.srt");
    expect(header).toContain('filename="____.srt"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toContain("\n");
  });
});
