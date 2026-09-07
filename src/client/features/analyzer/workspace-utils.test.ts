import { describe, expect, it } from "vitest";
import { filterJobs, resultToMarkdown, transcriptMatches, transcriptToSrt } from "./workspace-utils.js";

describe("workspace tools", () => {
  it("matches all query words across a title and summary within the selected status", () => {
    const jobs = [{ title: "Lecture 01", summary: "React state", status: "done" }, { title: "React", summary: "Lecture", status: "processing" }];
    expect(filterJobs(jobs, " REACT lecture ", "done")).toEqual([jobs[0]]);
    expect(filterJobs(jobs, "", "active")).toEqual([jobs[1]]);
    expect(filterJobs(jobs, "missing", "all")).toEqual([]);
  });
  it("exports valid SRT indices, hour boundaries, nonempty cues, and normalized line endings", () => {
    expect(transcriptToSrt([{ startMs: 3599999, endMs: 3601002, text: "Hello\r\n\r\nworld" }, { startMs: 0, endMs: 5, text: " " }, { startMs: -3, endMs: 0, text: "你好" }]))
      .toBe("1\n00:59:59,999 --> 01:00:01,002\nHello\nworld\n\n2\n00:00:00,000 --> 00:00:00,001\n你好\n");
    expect(transcriptToSrt([])).toBe("");
  });
  it("retains result sections and protects generated JSON with an adequate Markdown fence", () => {
    const md = resultToMarkdown({ title: "Video\nTitle", summary: "A summary", durationMs: 5000, chapters: [{ startMs: 1000, title: "Topic", summary: "Notes" }], transcript: [{ startMs: 1000, endMs: 2000, text: "Hi", speaker: "A" }], extractedData: { code: "```" } }, "en");
    expect(md).toContain("# Video Title");
    expect(md).toContain("### 00:00:01 · Topic");
    expect(md).toContain("**00:00:01 · A** Hi");
    expect(md).toContain("````json");
  });
  it("finds literal subtitle text without treating input as a regular expression", () => {
    const lines = [{ startMs: 0, endMs: 1, text: "React [state]" }, { startMs: 1, endMs: 2, text: "状态" }];
    expect(transcriptMatches(lines, "[STATE]")).toEqual([0]);
    expect(transcriptMatches(lines, "状")).toEqual([1]);
    expect(transcriptMatches(lines, " ")).toEqual([]);
  });
});
