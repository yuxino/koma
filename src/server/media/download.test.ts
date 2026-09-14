import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadUrl, streamToFile } from "./download.js";
import { VideoInputError } from "./url-source.js";

const media = vi.hoisted(() => ({ inspectVideo: vi.fn() }));
vi.mock("./video.js", () => media);
vi.mock("../config/config.js", () => ({ config: { maxUploadBytes: 1024, maxDurationSeconds: 900 } }));
const network = vi.fn<typeof fetch>();
const url = "https://cdn.example.com/video.mp4?signature=a%2Fb%2B%3D";
let root: string;
let output: string;

function mp4(major = "isom", compatible = "mp42"): Buffer {
  const data = Buffer.alloc(40);
  data.writeUInt32BE(24, 0);
  data.write("ftyp", 4);
  data.write(major, 8);
  data.write(major, 16);
  data.write(compatible, 20);
  data.writeUInt32BE(16, 24);
  data.write("mdat", 28);
  return data;
}
function response(data = mp4(), type: string | null = "video/mp4", extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(data), { headers: { ...(type ? { "content-type": type } : {}), ...extra } });
}
async function absent(): Promise<void> {
  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
}

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), "koma-direct-mp4-"));
  output = join(root, "input.mp4");
  network.mockReset();
  media.inspectVideo.mockReset().mockResolvedValue({ hasVideo: true, hasAudio: true, durationMs: 1000 });
  vi.stubGlobal("fetch", network);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

describe("direct MP4 download", () => {
  it.each(["video/mp4", "VIDEO/MP4; charset=binary", "application/mp4", "application/octet-stream", null])("downloads a verified MP4 served as %s without probing a platform", async (type) => {
    const bytes = mp4();
    network.mockResolvedValueOnce(response(bytes, type, { "content-length": String(bytes.length) }));
    await expect(downloadUrl(url, output)).resolves.toEqual({ contentType: "video/mp4" });
    expect(await readFile(output)).toEqual(bytes);
    expect(network).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" }));
    expect(media.inspectVideo).toHaveBeenCalledWith(output, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("recognizes an MP4 file type split across network chunks", async () => {
    const bytes = mp4();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } });
    network.mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "video/mp4" } }));
    await downloadUrl(url, output);
    expect(await readFile(output)).toEqual(bytes);
  });

  it.each(["https://v.douyin.com/example", "https://b23.tv/example", "https://youtube.com/watch?v=abc", "https://example.com/watch?file=video.mp4"]) ("rejects an unsupported input before making any request: %s", async (input) => {
    await expect(downloadUrl(input, output)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).not.toHaveBeenCalled();
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await absent();
  });

  it.each(["text/html", "text/plain", "application/json", "application/vnd.apple.mpegurl", "video/webm", "audio/mp4"]) ("rejects non-MP4 response types once, without inspecting their body: %s", async (type) => {
    const cancel = vi.fn();
    network.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { headers: { "content-type": type } }));
    await expect(downloadUrl(url, output)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await absent();
  });

  it.each([Buffer.from("<html>not a video</html>"), mp4("qt  ", "qt  "), mp4("avif", "avif"), Buffer.alloc(0), Buffer.from("ftyp")])("rejects HTML, non-MP4 containers and empty/truncated headers despite a .mp4 name and MIME", async (data) => {
    network.mockResolvedValueOnce(response(data));
    await expect(downloadUrl(url, output)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).toHaveBeenCalledOnce();
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await absent();
  });

  it("allows a direct file redirect and preserves signed query parameters", async () => {
    const next = "https://other.example.com/VIDEO.MP4?token=a%2Fb%2B%3D";
    network.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: next, "set-cookie": "platform=not-forwarded" } })).mockResolvedValueOnce(response());
    await downloadUrl(url, output);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls[1][0]).toBe(next);
    const headers = network.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("referer");
    expect(headers).not.toHaveProperty("origin");
  });

  it.each(["https://www.douyin.com/video/123", "https://b23.tv/example", "https://example.com/login", "http://127.0.0.1/private.mp4", "http://[::1]/private.mp4", "file:///tmp/private.mp4"]) ("rejects a redirect before requesting a platform page or private target: %s", async (next) => {
    const cancel = vi.fn();
    network.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: next } }));
    await expect(downloadUrl(url, output)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await absent();
  });

  it("caps file redirects without retrying the chain", async () => {
    network.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/next.mp4" } }));
    await expect(downloadUrl(url, output)).rejects.toThrow("重定向");
    expect(network).toHaveBeenCalledTimes(6);
  });

  it("rejects a partial 206 response instead of saving it as a complete video", async () => {
    network.mockResolvedValueOnce(new Response(new Uint8Array(mp4()), { status: 206, headers: { "content-type": "video/mp4" } }));
    await expect(downloadUrl(url, output)).rejects.toBeInstanceOf(VideoInputError);
    expect(network).toHaveBeenCalledOnce();
    await absent();
  });

  it("enforces the declared and streamed byte limits without retrying", async () => {
    network.mockResolvedValueOnce(response(mp4(), "video/mp4", { "content-length": "2048" }));
    await expect(downloadUrl(url, output)).rejects.toThrow("视频太大");
    expect(network).toHaveBeenCalledOnce();
    network.mockClear().mockResolvedValueOnce(response(Buffer.concat([mp4(), Buffer.alloc(2048)])));
    await expect(downloadUrl(url, output)).rejects.toThrow("视频太大");
    expect(network).toHaveBeenCalledOnce();
    await absent();
  });

  it("checks for a video track after local inspection", async () => {
    network.mockResolvedValueOnce(response());
    media.inspectVideo.mockResolvedValueOnce({ hasVideo: false, hasAudio: true });
    await expect(downloadUrl(url, output)).rejects.toThrow("没有视频画面");
    expect(network).toHaveBeenCalledOnce();
    await absent();
  });

  it("does not retry a permanent 404 or an overlong video", async () => {
    network.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(downloadUrl(url, output)).rejects.toThrow("404");
    expect(network).toHaveBeenCalledOnce();
    network.mockClear().mockResolvedValueOnce(response());
    media.inspectVideo.mockRejectedValueOnce(new Error("视频太长了"));
    await expect(downloadUrl(url, output)).rejects.toThrow("视频太长");
    expect(network).toHaveBeenCalledOnce();
    await absent();
  });

  it("only retries transient network errors against the supplied direct file", async () => {
    network.mockRejectedValueOnce(new TypeError("network interrupted")).mockResolvedValueOnce(response());
    await downloadUrl(url, output);
    expect(network).toHaveBeenCalledTimes(2);
    expect(network.mock.calls.every(([input]) => input === url)).toBe(true);
  });

  it("does not retain a truncated download after retries", async () => {
    network.mockImplementation(async () => response(mp4(), "video/mp4", { "content-length": "80" }));
    await expect(downloadUrl(url, output)).rejects.toThrow("重试 3 次");
    expect(network).toHaveBeenCalledTimes(3);
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await absent();
  });

  it("does not request an already-cancelled download", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadUrl(url, output, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(network).not.toHaveBeenCalled();
  });

  it("cancels an in-flight stream, removes its partial file and does not retry", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    network.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new Uint8Array(mp4())); }, cancel
    }), { headers: { "content-type": "video/mp4" } }));
    const promise = downloadUrl(url, output, { signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
    controller.abort();
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
    await absent();
  });

  it("does not restrict local uploads to MP4", async () => {
    const bytes = Buffer.from("a local upload may use another video container");
    await streamToFile(Readable.from([bytes]), output, 1024);
    expect(await readFile(output)).toEqual(bytes);
    expect(network).not.toHaveBeenCalled();
  });
});
