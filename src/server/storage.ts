import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type OSS from "ali-oss";

export type StorageDriver = "local" | "oss";

let ossClient: OSS | null = null;

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

export async function putStoredFile(key: string, filePath: string, mimeType: string): Promise<void> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    await (await getOssClient()).put(safeKey, filePath, { mime: mimeType, headers: { "cache-control": "private, max-age=3600" } });
    return;
  }
  const target = localObjectPath(safeKey);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(filePath, target);
}

export async function putStoredText(key: string, content: string, mimeType: string): Promise<void> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    await (await getOssClient()).put(safeKey, Buffer.from(content, "utf8"), { mime: mimeType, headers: { "cache-control": "private, max-age=3600" } });
    return;
  }
  const target = localObjectPath(safeKey);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
}

export async function readStoredText(key: string): Promise<string> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    const result = await (await getOssClient()).get(safeKey);
    return Buffer.isBuffer(result.content) ? result.content.toString("utf8") : String(result.content || "");
  }
  return readFile(localObjectPath(safeKey), "utf8");
}

export async function storedObjectInfo(key: string): Promise<{ path: string; size: number } | { url: string }> {
  const safeKey = normalizeKey(key);
  if (storageDriver() === "oss") {
    const publicBaseUrl = String(process.env.OSS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
    if (publicBaseUrl) return { url: `${publicBaseUrl}/${safeKey.split("/").map(encodeURIComponent).join("/")}` };
    return { url: (await getOssClient()).signatureUrl(safeKey, { expires: signedUrlSeconds(), method: "GET" }) };
  }
  const path = localObjectPath(safeKey);
  return { path, size: (await stat(path)).size };
}

export async function deleteStoredPrefix(prefix: string): Promise<void> {
  const safePrefix = `${normalizeKey(prefix).replace(/\/+$/, "")}/`;
  if (storageDriver() === "local") {
    await rm(localObjectPath(safePrefix), { recursive: true, force: true });
    return;
  }
  const client = await getOssClient();
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
  const { default: OssClient } = await import("ali-oss");
  ossClient = new OssClient({
    region: requiredEnv("OSS_REGION"),
    accessKeyId: requiredEnv("OSS_ACCESS_KEY_ID"),
    accessKeySecret: requiredEnv("OSS_ACCESS_KEY_SECRET"),
    bucket: requiredEnv("OSS_BUCKET"),
    secure: true,
    timeout: positiveInteger(process.env.OSS_TIMEOUT_MS, 120_000)
  });
  return ossClient;
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
