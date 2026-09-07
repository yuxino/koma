import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import OSS from "ali-oss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageWriteError, uploadOssObject } from "./oss-upload.js";
import { hasStorageWrite, type PendingStorageWrite } from "./storage-write-journal.js";

const SIZE = 8 * 1024 * 1024;
const KEY = "jobs/sdk/video.mp4";
const UPLOAD_ID = "sdk-test-upload";
let root: string;
let input: string;
let journal: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "koma-oss-sdk-"));
  input = join(root, "input.mp4");
  journal = join(root, "storage-write.json");
  await writeFile(input, "video");
  await truncate(input, SIZE);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

interface TransportRequest {
  method: string;
  headers: Record<string, string>;
  stream?: Readable;
  content?: string | Buffer;
}

type Operation =
  | { kind: "init" | "complete" | "abort" | "head" | "put" }
  | { kind: "part"; number: number };

function response(status: number, body = "", headers: Record<string, string> = {}) {
  const data = Buffer.from(body);
  // ali-oss consumes both urllib's top-level response and its nested res headers.
  return { status, headers, data, res: { status, headers, size: data.length, rt: 0 } };
}

type TransportResponse = ReturnType<typeof response>;
type Handler = (operation: Operation, request: TransportRequest) => Promise<TransportResponse>;

function sdkClient(handle: Handler): OSS {
  const urllib = {
    async request(url: string, request: TransportRequest): Promise<TransportResponse> {
      // Interpret requests locally; never forward them or retain signed URLs/headers in a trace.
      const query = new URL(url).searchParams;
      if (request.method === "HEAD") return handle({ kind: "head" }, request);
      if (request.method === "DELETE" && query.has("uploadId")) return handle({ kind: "abort" }, request);
      if (request.method === "POST" && query.has("uploads")) return handle({ kind: "init" }, request);
      if (request.method === "POST" && query.has("uploadId")) return handle({ kind: "complete" }, request);
      if (request.method === "PUT" && query.has("partNumber")) return handle({ kind: "part", number: Number(query.get("partNumber")) }, request);
      if (request.method === "PUT") return handle({ kind: "put" }, request);
      throw new Error("Unexpected operation in the offline OSS transport.");
    }
  };
  // These synthetic credentials are used only by the real SDK's local signing code.
  const options: OSS.Options & { retryMax: number; urllib: typeof urllib } = {
    bucket: "koma-sdk-test",
    region: "oss-cn-hangzhou",
    accessKeyId: "offline-test-key",
    accessKeySecret: "offline-test-secret",
    secure: true,
    timeout: 120_000,
    retryMax: 0,
    urllib
  };
  return new OSS(options);
}

function initialized() {
  return response(200, `<InitiateMultipartUploadResult><UploadId>${UPLOAD_ID}</UploadId></InitiateMultipartUploadResult>`);
}

function missingUpload() {
  return response(404, "<Error><Code>NoSuchUpload</Code><Message>Upload does not exist.</Message><RequestId>sdk-test-request</RequestId></Error>");
}

function responseTimeout() {
  return Object.assign(new Error("Response timeout for 120000ms"), { name: "ResponseTimeoutError", status: -1 });
}

function connectionError(message: string, code: string) {
  // urllib supplies the native code, but ali-oss 6.23 replaces it with result.name.
  return Object.assign(new Error(message), { name: "RequestError", status: -1, code });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function consume(request: TransportRequest): Promise<number> {
  if (!request.stream) return Buffer.byteLength(request.content || "");
  let bytes = 0;
  for await (const chunk of request.stream) bytes += Buffer.byteLength(chunk);
  return bytes;
}

async function pendingWrite(): Promise<PendingStorageWrite> {
  return JSON.parse(await readFile(journal, "utf8")) as PendingStorageWrite;
}

describe("real ali-oss upload and cancellation boundaries", () => {
  it("blocks Complete when cancellation arrives after the final part was sent but before its response", async () => {
    const controller = new AbortController();
    const finalPartSent = deferred();
    const finalResponse = deferred();
    const events: string[] = [];
    const partSizes: number[] = [];
    const client = sdkClient(async (operation, request) => {
      if (operation.kind === "init") { events.push("init"); return initialized(); }
      if (operation.kind === "part") {
        partSizes.push(await consume(request));
        events.push(`part:${operation.number}:sent`);
        if (operation.number === 2) { finalPartSent.resolve(); await finalResponse.promise; }
        events.push(`part:${operation.number}:response`);
        return response(200, "", { etag: `part-${operation.number}` });
      }
      if (operation.kind === "abort") { events.push("abort"); return response(204); }
      if (operation.kind === "complete") {
        // Unprotected ali-oss 6.23 reaches here with only part 1 in the completion XML.
        events.push("complete");
        return response(200, "<CompleteMultipartUploadResult/>", { etag: "completed" });
      }
      events.push(operation.kind);
      return response(404);
    });
    const outcome = uploadOssObject(client, KEY, input, "video/mp4", { signal: controller.signal, journalPath: journal }).catch(error => error);
    try {
      await finalPartSent.promise;
      expect(await pendingWrite()).toMatchObject({ phase: "parts", uploadId: UPLOAD_ID });
      events.push("cancel");
      controller.abort();
      expect(events).not.toContain("abort");
    } finally {
      finalResponse.resolve();
    }
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(partSizes).toEqual([SIZE / 2, SIZE / 2]);
    expect(events).toEqual(["init", "part:1:sent", "part:1:response", "part:2:sent", "cancel", "part:2:response", "abort"]);
    expect(await hasStorageWrite(journal)).toBe(false);
  });

  it("retains the committing journal when Complete loses its response and neither abort nor HEAD can confirm the outcome", async () => {
    const events: string[] = [];
    const completePhases: string[] = [];
    let completes = 0;
    const client = sdkClient(async (operation, request) => {
      events.push(operation.kind === "part" ? `part:${operation.number}` : operation.kind);
      if (operation.kind === "init") return initialized();
      if (operation.kind === "part") { await consume(request); return response(200, "", { etag: `part-${operation.number}` }); }
      if (operation.kind === "complete") {
        completePhases.push((await pendingWrite()).phase);
        if (++completes === 1) throw responseTimeout();
        return missingUpload();
      }
      if (operation.kind === "abort") return missingUpload();
      if (operation.kind === "head") return response(404);
      throw new Error("Unexpected upload operation.");
    });
    const abort = vi.spyOn(client, "abortMultipartUpload");
    await expect(uploadOssObject(client, KEY, input, "video/mp4", { journalPath: journal })).rejects.toBeInstanceOf(StorageWriteError);
    expect(completePhases).toEqual(["committing", "committing"]);
    expect(events).toEqual(["init", "part:1", "part:2", "complete", "head", "complete", "head", "abort"]);
    await expect(abort.mock.results[0].value).rejects.toMatchObject({ name: "NoSuchUploadError", code: "NoSuchUpload", status: 404 });
    expect(await pendingWrite()).toMatchObject({ key: KEY, uploadId: UPLOAD_ID, size: SIZE, phase: "committing" });
  });

  it.each([
    { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:1" },
    { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND offline.invalid" }
  ])("clears a definitely unsent PUT using the real SDK RequestError shape for $code", async ({ code, message }) => {
    const client = sdkClient(async operation => {
      if (operation.kind === "put") throw connectionError(message, code);
      if (operation.kind === "head") return response(404);
      throw new Error("Unexpected upload operation.");
    });
    const put = vi.spyOn(client, "put");
    await expect(uploadOssObject(client, KEY, Buffer.from("small"), "text/plain", { journalPath: journal })).rejects.toBeInstanceOf(StorageWriteError);
    expect(put).toHaveBeenCalledTimes(3);
    await expect(put.mock.results[0].value).rejects.toMatchObject({ name: "RequestError", code: "RequestError", status: -1, message });
    expect(await hasStorageWrite(journal)).toBe(false);
  });

  it("keeps the later PUT journal when an initial connection failure is followed by cancellation and a lost response", async () => {
    const controller = new AbortController();
    const secondPutSent = deferred();
    const secondResponse = deferred();
    let puts = 0;
    const client = sdkClient(async operation => {
      if (operation.kind === "head") return response(404);
      if (operation.kind !== "put") throw new Error("Unexpected upload operation.");
      if (++puts === 1) throw connectionError("connect ECONNREFUSED 127.0.0.1:1", "ECONNREFUSED");
      secondPutSent.resolve();
      await secondResponse.promise;
      throw responseTimeout();
    });
    const outcome = uploadOssObject(client, KEY, Buffer.from("small"), "text/plain", { signal: controller.signal, journalPath: journal }).catch(error => error);
    try {
      await secondPutSent.promise;
      expect(await pendingWrite()).toMatchObject({ key: KEY, size: 5, phase: "committing" });
      controller.abort();
    } finally {
      secondResponse.resolve();
    }
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(puts).toBe(2);
    expect(await pendingWrite()).toMatchObject({ key: KEY, size: 5, phase: "committing" });
  });
});
