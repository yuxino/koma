import { describe, expect, it } from "vitest";
import { headersForVideoUrl, isDouyinHost, normalizeVideoUrl } from "./url-source.js";

describe("video URL normalization", () => {
  it("adds https to a protocol-relative URL", () => {
    expect(normalizeVideoUrl("//www.douyin.com/aweme/v1/play/?video_id=test"))
      .toBe("https://www.douyin.com/aweme/v1/play/?video_id=test");
  });

  it("adds https to a bare domain URL", () => {
    expect(normalizeVideoUrl("www.douyin.com/aweme/v1/play/?video_id=test"))
      .toBe("https://www.douyin.com/aweme/v1/play/?video_id=test");
  });

  it("keeps an absolute URL unchanged", () => {
    expect(normalizeVideoUrl(" https://cdn.example.com/video.mp4 "))
      .toBe("https://cdn.example.com/video.mp4");
  });
});

describe("video URL source headers", () => {
  it("adds browser headers required by Douyin CDN redirects", () => {
    const headers = headersForVideoUrl("https://www.douyin.com/aweme/v1/play/?video_id=test");
    expect(headers.referer).toBe("https://www.douyin.com/");
    expect(headers.origin).toBe("https://www.douyin.com");
    expect(headers.accept).toContain("video/mp4");
  });

  it("does not send a Douyin referrer to unrelated video hosts", () => {
    const headers = headersForVideoUrl("https://cdn.example.com/video.mp4");
    expect(headers.referer).toBeUndefined();
    expect(isDouyinHost("cdn.example.com")).toBe(false);
  });
});
