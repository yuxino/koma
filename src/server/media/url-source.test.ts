import { afterEach, describe, expect, it, vi } from "vitest";
import { DIRECT_MP4_REQUIRED, headersForVideoUrl, normalizeVideoUrl, prepareDirectVideoUrl, validateDirectVideoUrl, VideoInputError } from "./url-source.js";

afterEach(() => vi.unstubAllGlobals());

describe("direct MP4 input", () => {
  it.each([
    ["https://cdn.example.com/video.mp4", "https://cdn.example.com/video.mp4"],
    [" http://cdn.example.com/VIDEO.MP4 ", "http://cdn.example.com/VIDEO.MP4"],
    ["//cdn.example.com/video.mp4", "https://cdn.example.com/video.mp4"],
    ["cdn.example.com/video.mp4", "https://cdn.example.com/video.mp4"],
    ["https://cdn.example.com/video.%6dp4", "https://cdn.example.com/video.%6dp4"],
    ["https://cdn.example.com/video.mp4?Expires=123&Signature=a%2Fb%2B%3D&name=x+y", "https://cdn.example.com/video.mp4?Expires=123&Signature=a%2Fb%2B%3D&name=x+y"]
  ])("accepts %s without changing its signed query", (input, expected) => {
    expect(validateDirectVideoUrl(input)).toBe(expected);
  });

  it("retains basic URL normalization without extracting URLs from text", () => {
    expect(normalizeVideoUrl("//example.com/video.mp4")).toBe("https://example.com/video.mp4");
    expect(normalizeVideoUrl("copy https://example.com/video.mp4")).toBe("copy https://example.com/video.mp4");
  });

  it.each([
    "https://v.douyin.com/example/", "https://www.douyin.com/video/123",
    "https://www.bilibili.com/video/BV1xx411c7mD", "https://b23.tv/example",
    "https://www.youtube.com/watch?v=example", "https://youtu.be/example",
    "https://www.xiaohongshu.com/explore/example", "https://xhslink.com/example",
    "https://example.com/watch?file=video.mp4", "https://example.com/watch#video.mp4",
    "https://example.com/stream.m3u8", "https://example.com/video.webm", "https://example.com/video.mov",
    "copy https://example.com/video.mp4", "https://example.com/a.mp4 https://example.com/b.mp4",
    "https://example.com/video.mp4\ncopy", "https://example.com/vi\tdeo.mp4", "https:\\example.com\\video.mp4",
    "https://example.com/%zz.mp4", "not a URL"
  ])("rejects pages, playlists and share text without network access: %s", async (input) => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    expect(() => validateDirectVideoUrl(input)).toThrow(DIRECT_MP4_REQUIRED);
    await expect(prepareDirectVideoUrl(input)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 123, {}, [], "", "   "])("rejects missing/non-text input: %j", (input) => {
    expect(() => validateDirectVideoUrl(input)).toThrow("请输入 MP4 视频直链");
  });

  it.each([
    "file:///tmp/video.mp4", "ftp://example.com/video.mp4", "data:video/mp4;base64,AA==",
    "https://user:password@example.com/video.mp4", "http://localhost/video.mp4",
    "http://x.localhost/video.mp4", "http://localhost./video.mp4", "http://internal/video.mp4",
    "http://127.0.0.1/video.mp4", "http://2130706433/video.mp4", "http://0x7f000001/video.mp4",
    "http://10.0.0.1/video.mp4", "http://169.254.169.254/video.mp4", "http://172.16.0.1/video.mp4",
    "http://192.168.1.1/video.mp4", "http://100.64.0.1/video.mp4", "http://[::1]/video.mp4",
    "http://[::ffff:127.0.0.1]/video.mp4", "http://[fe80::1]/video.mp4", "http://[fd00::1]/video.mp4"
  ])("rejects non-HTTP, authenticated and local-network targets: %s", (input) => {
    expect(() => validateDirectVideoUrl(input)).toThrow(VideoInputError);
  });

  it("does not access a URL when already cancelled", async () => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const controller = new AbortController();
    controller.abort();
    await expect(prepareDirectVideoUrl("https://example.com/video.mp4", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(network).not.toHaveBeenCalled();
  });

  it("does not synthesize platform cookies, referers or browser identity", () => {
    const headers = headersForVideoUrl("https://cdn.example.com/video.mp4");
    expect(headers).toEqual({ accept: "video/mp4,application/mp4,application/octet-stream;q=0.8", "user-agent": "Koma/0.1", "accept-encoding": "identity" });
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("referer");
    expect(headers).not.toHaveProperty("origin");
  });
});
