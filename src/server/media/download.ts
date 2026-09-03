import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../config/config.js";
import { headersForVideoUrl } from "./url-source.js";
import { inspectVideo, probeRemoteVideoDuration } from "./video.js";

export interface DownloadResult {
  contentType: string;
}

type ProgressCallback = (percent: number, detail: string) => void;

// 把真实播放地址下载成临时文件；下载过程通过 onProgress 回报 8%–11% 的进度，
// 避免用户长时间只看到“正在放入…”没有任何反馈。
export async function downloadUrl(
  url: string,
  outputPath: string,
  { referer, signal, onProgress }: { referer?: string; signal?: AbortSignal; onProgress?: ProgressCallback } = {}
): Promise<DownloadResult> {
  // 请求头在探测与下载之间保持一致（部分视频源按 referer/UA 校验）
  const requestHeaders = { ...headersForVideoUrl(url), ...(referer ? { referer } : {}) };

  // 下载前先探测时长：faststart 视频用 Range 请求就能拿到元数据，
  // 超长直接拒绝，避免把整段视频拉下来才发现超时。
  const probedMs = await probeRemoteVideoDuration(url, requestHeaders, { signal });
  if (probedMs !== null && probedMs > config.maxDurationSeconds * 1000) {
    throw new Error(`视频太长了，第一版最多支持 ${Math.round(config.maxDurationSeconds / 60)} 分钟。`);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(outputPath, { force: true });
      onProgress?.(8, "正在连接视频源。");
      const response = await fetch(url, {
        redirect: "follow",
        headers: { ...requestHeaders, "accept-encoding": "identity" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
      });
      if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
      if (!response.ok || !response.body) throw new Error(`视频地址无法访问：${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html") || contentType.includes("text/plain")) throw new Error("这个地址返回的是网页，没有解析出可下载的视频文件。抖音/B站分享链接可能被风控或是图文笔记，也可以换成视频直链试试。");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > config.maxUploadBytes) throw new Error(`视频太大了，第一版最多支持 ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB。`);
      const stream = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      const bytes = await streamToFile(stream, outputPath, config.maxUploadBytes, contentLength, onProgress);
      if (!bytes) throw new Error("视频下载结果为空。");
      if (contentLength && bytes !== contentLength) throw new Error(`视频下载不完整（收到 ${bytes} / ${contentLength} 字节）。`);
      await inspectVideo(outputPath, { signal });
      onProgress?.(12, "视频已进入临时空间。");
      return { contentType };
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (error instanceof Error && (error.message.startsWith("视频太长") || error.message.includes("不是可直接下载的视频"))) throw error;
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
  onProgress?: ProgressCallback
): Promise<number> {
  let bytes = 0;
  let lastReportedPercent = -1;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error(`视频太大了，第一版最多支持 ${Math.round(maxBytes / 1024 / 1024)} MB。`));
      if (contentLength && onProgress) {
        const percent = 8 + Math.floor((bytes / contentLength) * 4);
        if (percent !== lastReportedPercent) {
          lastReportedPercent = percent;
          onProgress(Math.min(11, percent), `正在取回视频 ${Math.round(bytes / 1024 / 1024)} MB。`);
        }
      }
      callback(null, chunk);
    }
  });
  await pipeline(readable, counter, createWriteStream(outputPath));
  return bytes;
}
