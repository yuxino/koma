import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config/config.js";
import { headersForVideoUrl, validateDirectVideoUrl, VideoInputError } from "./url-source.js";
import { inspectVideo } from "./video.js";

export interface DownloadResult {
  contentType: string;
}

type ProgressCallback = (percent: number, detail: string) => void;
const MAX_REDIRECTS = 5;
const MAX_FILE_TYPE_BYTES = 64 * 1024;
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "iso7", "iso8", "iso9", "mp41", "mp42", "avc1", "M4V ", "MSNV", "dash"]);
const NOT_MP4 = "这个地址不是有效的 MP4 视频文件，请上传本地视频或提供 MP4 直链。";

/** Follow file-to-file redirects only; never visit a share page or extract a player URL. */
async function fetchDirectMp4(url: string, signal: AbortSignal): Promise<Response> {
  let current = validateDirectVideoUrl(url);
  for (let redirects = 0; ; redirects += 1) {
    signal.throwIfAborted();
    const response = await fetch(current, {
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: headersForVideoUrl(current),
      signal
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirects >= MAX_REDIRECTS) throw new VideoInputError("MP4 直链重定向无效或次数太多。");
    // Validation happens before the next request, including private-host and .mp4 checks.
    try { current = validateDirectVideoUrl(new URL(location, current).href); }
    catch (error) { throw error instanceof VideoInputError ? error : new VideoInputError(NOT_MP4); }
  }
}

// Download only the supplied MP4 file, then inspect it locally. No remote pre-probe or page parsing.
export async function downloadUrl(
  url: string,
  outputPath: string,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: ProgressCallback } = {}
): Promise<DownloadResult> {
  signal?.throwIfAborted();
  const directUrl = validateDirectVideoUrl(url);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response | undefined;
    try {
      signal?.throwIfAborted();
      await rm(outputPath, { force: true });
      onProgress?.(8, "正在连接视频源。");
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
      response = await fetchDirectMp4(directUrl, requestSignal);
      requestSignal.throwIfAborted();
      if (!response.ok || !response.body) {
        const message = `视频地址无法访问：${response.status}`;
        if (response.status < 500 && response.status !== 429) throw new VideoInputError(message);
        throw new Error(message);
      }
      // A partial response to our full GET must not be saved as the original video.
      if (response.status !== 200) throw new VideoInputError(NOT_MP4);
      const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
      if (contentType && !["video/mp4", "application/mp4", "application/octet-stream"].includes(contentType)) {
        throw new VideoInputError(NOT_MP4);
      }
      const declaredLength = Number(response.headers.get("content-length") || 0);
      const contentLength = Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0;
      if (contentLength > config.maxUploadBytes) throw new VideoInputError(`视频太大了，第一版最多支持 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB。`);
      const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      const bytes = await streamToFile(stream, outputPath, config.maxUploadBytes, contentLength, onProgress, requestSignal, true);
      if (!bytes) throw new VideoInputError(NOT_MP4);
      if (contentLength && bytes !== contentLength) throw new Error(`视频下载不完整（收到 ${bytes} / ${contentLength} 字节）。`);
      const media = await inspectVideo(outputPath, { signal: requestSignal });
      if (!media.hasVideo) throw new VideoInputError("这个文件里没有视频画面，请换一个带画面的视频。");
      onProgress?.(12, "视频已进入临时空间。");
      return { contentType: "video/mp4" };
    } catch (error) {
      lastError = error;
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
      await rm(outputPath, { force: true }).catch(() => undefined);
      if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof VideoInputError || (error instanceof Error && /视频太长|视频太大/.test(error.message))) throw error;
      if (attempt < 3) onProgress?.(8, `视频没有完整到达，正在重新取回（${attempt}/3）。`);
    }
  }
  throw new Error(`视频下载不完整，已自动重试 3 次。${lastError instanceof Error ? ` ${lastError.message}` : ""}`);
}

export async function streamToFile(
  readable: NodeJS.ReadableStream,
  outputPath: string,
  maxBytes: number,
  contentLength = 0,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
  requireMp4 = false
): Promise<number> {
  let bytes = 0;
  let lastReportedPercent = -1;
  let fileTypeChecked = !requireMp4;
  let header: Buffer = Buffer.alloc(0);
  const counter = new Transform({
    transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new VideoInputError(`视频太大了，第一版最多支持 ${Math.round(maxBytes / 1024 / 1024)} MB。`));
      if (!fileTypeChecked) {
        header = Buffer.concat([header, chunk.subarray(0, MAX_FILE_TYPE_BYTES - header.length)]);
        if (header.length >= 8) {
          const size = header.readUInt32BE(0);
          if (header.toString("ascii", 4, 8) !== "ftyp" || size < 16 || size > MAX_FILE_TYPE_BYTES || size % 4 !== 0) return callback(new VideoInputError(NOT_MP4));
          if (header.length >= size) {
            const brands = [header.toString("ascii", 8, 12)];
            for (let offset = 16; offset < size; offset += 4) brands.push(header.toString("ascii", offset, offset + 4));
            if (!brands.some((brand) => MP4_BRANDS.has(brand))) return callback(new VideoInputError(NOT_MP4));
            fileTypeChecked = true;
            header = Buffer.alloc(0);
          }
        }
      }
      if (contentLength && onProgress) {
        const percent = 8 + Math.floor((bytes / contentLength) * 4);
        if (percent !== lastReportedPercent) {
          lastReportedPercent = percent;
          onProgress(Math.min(11, percent), `正在取回视频 ${Math.round(bytes / 1024 / 1024)} MB。`);
        }
      }
      callback(null, chunk);
    },
    flush(callback) { callback(fileTypeChecked ? null : new VideoInputError(NOT_MP4)); }
  });
  await pipeline(readable, counter, createWriteStream(outputPath), { signal });
  return bytes;
}
