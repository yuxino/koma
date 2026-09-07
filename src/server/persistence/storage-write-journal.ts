import { chmod, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type OSS from "ali-oss";

export interface PendingStorageWrite {
  key: string;
  marker: string;
  size: number;
  phase: "parts" | "committing";
  uploadId?: string;
}

export class StorageCleanupError extends Error {
  statusCode = 503;
  constructor() { super("远端文件清理尚未确认，请稍后再次删除任务。"); this.name = "StorageCleanupError"; }
}

export function storageWriteJournalPath(directory: string): string { return join(directory, "storage-write.json"); }

export async function saveStorageWrite(path: string | undefined, state: PendingStorageWrite): Promise<void> {
  if (!path) return;
  await chmod(dirname(path), 0o700);
  await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

export async function clearStorageWrite(path?: string): Promise<void> {
  if (path) await rm(path, { force: true });
}

export async function hasStorageWrite(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export async function confirmStoredWrite(client: OSS, state: PendingStorageWrite): Promise<boolean> {
  try {
    const result = await client.head(state.key);
    const headers = result.res.headers as Record<string, string | undefined>;
    return headers["x-oss-meta-koma-upload-id"] === state.marker && Number(headers["content-length"]) === state.size;
  } catch { return false; }
}

export function missingMultipartUpload(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; name?: unknown };
  return value.code === "NoSuchUpload" || value.name === "NoSuchUploadError";
}

// Called on an explicit owner/admin deletion. An ambiguous Complete must not vanish with its DB row.
export async function settleStorageWrite(client: OSS, path: string, prefix: string): Promise<void> {
  if (!await hasStorageWrite(path)) return;
  let state: PendingStorageWrite;
  try {
    state = JSON.parse(await readFile(path, "utf8")) as PendingStorageWrite;
    if (!state || typeof state.key !== "string" || !state.key.startsWith(prefix) || state.key.length <= prefix.length
      || state.key !== state.key.trim() || state.key.includes("..") || /[\\\u0000-\u001f\u007f]/.test(state.key)
      || state.key.split("/").some(part => !part || part === ".")
      || typeof state.marker !== "string" || !state.marker || state.marker.length > 256
      || (state.uploadId !== undefined && (typeof state.uploadId !== "string" || !state.uploadId || state.uploadId.length > 1024))
      || !Number.isSafeInteger(state.size) || state.size < 0 || !["parts", "committing"].includes(state.phase)) throw new Error("Invalid journal");
  } catch { throw new StorageCleanupError(); }
  if (state.uploadId) {
    try {
      await client.abortMultipartUpload(state.key, state.uploadId);
      await clearStorageWrite(path);
      return;
    } catch (error) {
      if (state.phase === "parts" && missingMultipartUpload(error)) { await clearStorageWrite(path); return; }
    }
  } else if (state.phase === "parts") {
    // Initialization never supplied an ID, so this client could not send parts or Complete.
    await clearStorageWrite(path);
    return;
  }
  if (await confirmStoredWrite(client, state)) { await clearStorageWrite(path); return; }
  throw new StorageCleanupError();
}
