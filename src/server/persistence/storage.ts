import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type OSS from "ali-oss";
import { uploadOssObject, type StoredWriteOptions } from "./oss-upload.js";
import { settleStorageWrite } from "./storage-write-journal.js";

export type StorageDriver = "local" | "oss";

let ossClient: OSS | null = null;
const activeWrites = new Map<Promise<void>, string>();

export function storageDriver(): StorageDriver {
  const value = String(process.env.STORAGE_DRIVER || "local").trim().toLowerCase();
  if (value !== "local" && value !== "oss") throw new Error(`不支持的 STORAGE_DRIVER：${value}`);
  return value;
}

export function storagePrefix(): string {
  return normalizeKey(process.env.OSS_UPLOAD_PREFIX || "koma");
}

export function jobStoragePrefix(jobId: string): string {
  if (!/^[a-f0-9-]{20,64}$/i.test(jobId)) throw new Error("非法任务 ID。");
  return `${storagePrefix()}/jobs/${jobId}`;
}

export async function initializeStorage(): Promise<void> {
  if (storageDriver() === "local") {
    await mkdir(localRoot(), { recursive: true, mode: 0o700 });
    return;
  }
  const client = await getOssClient();
  await client.listV2({ prefix: `${storagePrefix()}/`, "max-keys": 1 });
}

export async function putStoredFile(key: string, filePath: string, mimeType: string, options: StoredWriteOptions = {}): Promise<void> {
  const safeKey = normalizeKey(key);
  await trackWrite(safeKey, async () => {
    options.signal?.throwIfAborted();
    if (storageDriver() === "oss") return uploadOssObject(await createOssClient(), safeKey, filePath, mimeType, options);
    const target = localObjectPath(safeKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(filePath, target);
  });
}

export async function putStoredText(key: string, content: string, mimeType: string, options: StoredWriteOptions = {}): Promise<void> {
  const safeKey = normalizeKey(key);
  await trackWrite(safeKey, async () => {
    options.signal?.throwIfAborted();
    if (storageDriver() === "oss") return uploadOssObject(await createOssClient(), safeKey, Buffer.from(content, "utf8"), mimeType, options);
    const target = localObjectPath(safeKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  });
}

async function trackWrite(key: string, write: () => Promise<void>): Promise<void> {
  const operation = write();
  activeWrites.set(operation, key);
  try { await operation; } finally { activeWrites.delete(operation); }
}

export async function readStoredText(key: string): Promise<string> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    const result = await (await getOssClient()).get(safeKey);
    return Buffer.isBuffer(result.content) ? result.content.toString("utf8") : String(result.content || "");
  }
  return readFile(localObjectPath(safeKey), "utf8");
}

export async function copyStoredFile(key: string, target: string): Promise<void> {
  const safeKey = normalizeKey(key);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  if (storageDriver() === "oss") {
    await (await getOssClient()).get(safeKey, target);
    return;
  }
  await copyFile(localObjectPath(safeKey), target);
}

export async function storedObjectInfo(key: string, options: { private?: boolean; contentDisposition?: string } = {}): Promise<{ path: string; size: number } | { url: string }> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    const publicBaseUrl = String(process.env.OSS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    if (publicBaseUrl && !options.private && !options.contentDisposition) return { url: `${publicBaseUrl}/${safeKey.split("/").map(encodeURIComponent).join("/")}` };
    return { url: (await getOssClient()).signatureUrl(safeKey, {
      expires: signedUrlSeconds(),
      method: "GET",
      ...(options.contentDisposition ? { response: { "content-disposition": options.contentDisposition } } : {})
    }) };
  }
  const path = localObjectPath(safeKey);
  return { path, size: (await stat(path)).size };
}

export async function makeStoredPrefixPrivate(prefix: string): Promise<void> {
  if (storageDriver() === "local") return;
  const safePrefix = `${normalizeKey(prefix).replace(/\/+$/, "")}/`;
  const client = await getOssClient();
  let continuationToken: string | undefined;
  do {
    const result = await client.listV2({ prefix: safePrefix, "max-keys": 1000, ...(continuationToken ? { "continuation-token": continuationToken } : {}) });
    for (const object of result.objects || []) await client.putACL(object.name, "private");
    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined;
  } while (continuationToken);
}

export async function deleteStoredPrefix(prefix: string, options: { journalPath?: string } = {}): Promise<void> {
  const safePrefix = `${normalizeKey(prefix).replace(/\/+$/, "")}/`;
  // A canceled CompleteMultipartUpload can still finish. Delete only after writers settle.
  await Promise.allSettled([...activeWrites].filter(([, key]) => key.startsWith(safePrefix)).map(([operation]) => operation));
  if (storageDriver() === "local") {
    await rm(localObjectPath(safePrefix), { recursive: true, force: true });
    return;
  }
  const client = await getOssClient();
  if (options.journalPath) await settleStorageWrite(await createOssClient(), options.journalPath, safePrefix);
  let continuationToken: string | undefined;
  do {
    const result = await client.listV2({ prefix: safePrefix, "max-keys": 1000, ...(continuationToken ? { "continuation-token": continuationToken } : {}) });
    const names = (result.objects || []).map((object) => object.name);
    if (names.length) await client.deleteMulti(names, { quiet: true });
    continuationToken = result.isTruncated ? result.nextContinuationToken : undefined;
  } while (continuationToken);
}

export function storageHealth() {
  return { driver: storageDriver(), prefix: storagePrefix() };
}

async function getOssClient(): Promise<OSS> {
  if (ossClient) return ossClient;
  ossClient = await createOssClient();
  return ossClient;
}

async function createOssClient(): Promise<OSS> {
  const { default: OssClient } = await import("ali-oss");
  const options: OSS.Options & { retryMax: number } = {
    region: requiredEnv("OSS_REGION"),
    accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET"),
    bucket: requiredEnv("OSS_BUCKET"),
    secure: true,
    retryMax: 0,
    timeout: positiveInteger(process.env.OSS_TIMEOUT_MS, 120_000)
  };
  return new OssClient(options);
}

function localRoot(): string {
  return resolve(process.env.LOCAL_STORAGE_PATH || join(process.cwd(), "data", "storage"));
}

function localObjectPath(key: string): string {
  const root = localRoot();
  const path = resolve(root, normalizeKey(key));
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error("非法存储路径。");
  }
  return path;
}

function normalizeKey(value: string): string {
  const key = value.trim().replace(/^\/+|\/+$/g, "").replace(/\\/g, "/");
  if (!key || key.includes("..") || key.split("/").some((part) => !part || part === ".")) throw new Error("非法存储对象路径。");
  return key;
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`STORAGE_DRIVER=oss 时必须配置 ${name}。`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function signedUrlSeconds(): number {
  return Math.min(3600, positiveInteger(process.env.OSS_SIGNED_URL_SECONDS, 900));
}
