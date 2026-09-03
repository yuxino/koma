import { describe, expect, it } from "vitest";
import { parseByteRange } from "./video-stream.js";

describe("video byte ranges", () => {
  it("parses an explicit byte range", () => {
    expect(parseByteRange("bytes=100-299", 1000)).toEqual({ start: 100, end: 299 });
  });

  it("clamps an open range to the file size", () => {
    expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("supports suffix ranges", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
  });

  it("rejects malformed or unsatisfiable ranges", () => {
    expect(parseByteRange("items=0-10", 1000)).toBeNull();
    expect(parseByteRange("bytes=1000-1200", 1000)).toBeNull();
    expect(parseByteRange("bytes=300-100", 1000)).toBeNull();
  });
});
