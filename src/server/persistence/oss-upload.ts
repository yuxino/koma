import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type OSS from "ali-oss";
import { clearStorageWrite, confirmStoredWrite, missingMultipartUpload, saveStorageWrite, type PendingStorageWrite } from "./storage-write-journal.js";

const PART_SIZE = 4 * 1024 * 1024;
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

export class StorageWriteError extends Error {
  constructor(error: unknown, attempts: number) {
    const details = safeStorageError(error);
    super(`保存文件到长期存储失败（尝试 ${attempts} 次）。${details}`);
    this.name = "StorageWriteError";
  }
}

export interface StoredWriteOptions { signal?: AbortSignal; journalPath?: string }

// Use an isolated client: ali-oss cancellation and multipart streams are client-wide.
export async function uploadOssObject(client: OSS, key: string, source: string | Buffer, mime: string, { signal, journalPath }: StoredWriteOptions = {}): Promise<void> {
  throwIfAborted(signal);
  const initial = typeof source === "string" ? await sourceFileInfo(source) : undefined;
  if (initial && !initial.isFile()) throw new Error("上传来源不是普通文件。");
  const size = initial?.size ?? (source as Buffer).length;
  const multipart = typeof source === "string" && size >= MULTIPART_THRESHOLD;
  const uploadToken = randomUUID();
  const options = {
    mime,
    headers: { "cache-control": "private, no-store", "x-oss-object-acl": "private" },
    // @types/ali-oss incorrectly requires example uid/pid properties on arbitrary metadata.
    meta: { "koma-upload-id": uploadToken } as unknown as OSS.UserMeta
  };
  const state: PendingStorageWrite = { key, marker: uploadToken, size, phase: multipart ? "parts" : "committing" };
  let checkpoint: OSS.Checkpoint | undefined;
  let completed = false;
  let attempts = 0;
  let lastError: unknown;
  let ambiguous = false;
  let requested = false;
  const completeMultipartUpload = client.completeMultipartUpload;
  if (multipart) {
    // 6.23 can reach Complete after a cancelled final part without recording that part.
    // Guard the actual API boundary, not only the SDK's optional progress callback.
    client.completeMultipartUpload = async (name, uploadId, parts, completeOptions) => {
      throwIfAborted(signal);
      const expected = Math.ceil(size / PART_SIZE);
      const ordered = [...parts].sort((a, b) => a.number - b.number);
      if (name !== key || uploadId !== checkpoint?.uploadId || ordered.length !== expected
        || ordered.some((part, index) => part.number !== index + 1 || !part.etag)) {
        throw Object.assign(new Error("Incomplete multipart checkpoint"), { name: "InvalidCheckpointError" });
      }
      state.uploadId = uploadId;
      state.phase = "committing";
      await saveJournal(journalPath, state);
      throwIfAborted(signal);
      return completeMultipartUpload.call(client, name, uploadId, parts, completeOptions);
    };
  }
  const cancel = () => client.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await saveJournal(journalPath, state).catch(error => { throw new StorageWriteError(error, 1); });
    for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
      throwIfAborted(signal);
      if (initial && typeof source === "string") {
        const current = await sourceFileInfo(source);
        if (current.size !== initial.size || current.mtimeMs !== initial.mtimeMs || current.ino !== initial.ino) {
          throw new Error("上传来源已改变，请重新导入视频。");
        }
      }
      throwIfAborted(signal);
      try {
        requested = true;
        if (multipart) {
          await client.multipartUpload(key, source, {
            ...options,
            partSize: PART_SIZE,
            // 6.23 resolves parallel uploads on the first failure, before other parts settle.
            parallel: 1,
            checkpoint,
            progress: async (_percent: number, next?: OSS.Checkpoint) => {
              if (!next) return;
              checkpoint = next;
              if (state.uploadId !== next.uploadId) {
                state.uploadId = next.uploadId;
                // Persist the ID before the first part. Complete records its own boundary.
                await saveJournal(journalPath, state);
              }
            }
          });
        } else {
          await client.put(key, source, options);
        }
        completed = true;
        await clearStorageWrite(journalPath);
        throwIfAborted(signal);
        return;
      } catch (error) {
        lastError = error;
        const transient = transientStorageError(error);
        ambiguous ||= transient && state.phase === "committing" && !connectionNotSent(error);
        // Cancellation may follow an earlier connection failure; retain this request's outcome.
        throwIfAborted(signal);
        // A lost PUT/Complete response can still leave a complete object. Size alone is unsafe.
        if (transient || errorField(error, "code") === "NoSuchUpload" || errorField(error, "name") === "abort") {
          if (await confirmStoredWrite(client, state)) {
            completed = true;
            await clearStorageWrite(journalPath);
            throwIfAborted(signal);
            return;
          }
        }
        throwIfAborted(signal);
        if (!transient || attempts === MAX_ATTEMPTS) break;
        await delay(500 * 2 ** (attempts - 1), undefined, { signal });
      }
    }
    throw new StorageWriteError(lastError, Math.min(attempts, MAX_ATTEMPTS));
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (multipart) client.completeMultipartUpload = completeMultipartUpload;
    // No active part remains with parallel:1. Never delete an object on an ambiguous failure.
    if (!completed) {
      let aborted = false;
      if (checkpoint?.uploadId) {
        await client.abortMultipartUpload(key, checkpoint.uploadId).then(() => { aborted = true; }).catch(error => {
          if (state.phase === "parts" && missingMultipartUpload(error)) aborted = true;
        });
      }
      const rejected = Number(errorField(lastError, "status"));
      const definitiveRejection = !ambiguous && !checkpoint?.uploadId
        && (connectionNotSent(lastError) || (rejected >= 400 && rejected < 500 && ![408, 429].includes(rejected)));
      if (!requested || aborted || (state.phase === "parts" && !checkpoint?.uploadId) || definitiveRejection) {
        await clearStorageWrite(journalPath).catch(() => undefined);
      }
    }
  }
}

async function sourceFileInfo(path: string) {
  try {
    return await stat(path);
  } catch {
    throw Object.assign(new Error("无法读取上传源文件，请重新导入视频。"), { name: "UploadSourceError" });
  }
}

async function saveJournal(path: string | undefined, state: PendingStorageWrite): Promise<void> {
  try { await saveStorageWrite(path, state); } catch (error) {
    throw Object.assign(new Error("无法保存存储恢复记录。"), { name: "StorageJournalError", code: errorField(error, "code") });
  }
}

function transientStorageError(error: unknown): boolean {
  const name = errorField(error, "name");
  const code = errorField(error, "code");
  const status = Number(errorField(error, "status"));
  return connectionNotSent(error) || ["ResponseTimeoutError", "ConnectionTimeoutError", "TimeoutError", "RequestTimeoutError"].includes(name)
    || ["RequestTimeout", "ConnectionTimeout", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "EAI_AGAIN"].includes(code)
    || [-1, -2, 408, 429, 500, 502, 503, 504].includes(status);
}

function connectionNotSent(error: unknown): boolean {
  return ["ConnectionTimeoutError", "ConnectTimeoutError"].includes(errorField(error, "name"))
    || ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"].includes(errorField(error, "code"))
    // ali-oss replaces urllib's errno with RequestError; only recognize known connect/DNS failures.
    || (errorField(error, "name") === "RequestError" && errorField(error, "status") === "-1"
      && /^(?:connect (?:ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)|getaddrinfo (?:ENOTFOUND|EAI_AGAIN))\b/.test(errorField(error, "message")));
}

function errorField(error: unknown, key: string): string {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function safeStorageError(error: unknown): string {
  const fields = [errorField(error, "name"), errorField(error, "code"), errorField(error, "status")].filter(Boolean);
  const message = errorField(error, "message") || (typeof error === "string" ? error : "存储服务未返回详细错误。");
  return `${[...new Set(fields)].join(" / ")}${fields.length ? ": " : ""}${message}`
    .replace(/https?:\/\/[^\s<>"']+/gi, "[URL removed]")
    .replace(/["']?(?:authorization|(?:x-oss-)?security[-_]?token|access[-_]?key(?:id|secret)?|signature)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n,;]+)/gi, "[credential removed]")
    .replace(/\bLTAI[A-Za-z0-9]+\b/g, "[credential removed]")
    .replace(/[\r\n\u0000-\u001f]+/g, " ")
    .slice(0, 700);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
}
