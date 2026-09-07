import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OSS from "ali-oss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasStorageWrite, saveStorageWrite, settleStorageWrite, StorageCleanupError, type PendingStorageWrite } from "./storage-write-journal.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(phase: PendingStorageWrite["phase"] = "committing") {
  const dir = await mkdtemp(join(tmpdir(), "koma-oss-journal-")); cleanup.push(dir);
  const path = join(dir, "storage-write.json");
  const state: PendingStorageWrite = { key: "jobs/test/video.mp4", marker: "this-upload", size: 1024, uploadId: "test-upload", phase };
  await saveStorageWrite(path, state);
  const methods = { abortMultipartUpload: vi.fn().mockRejectedValue({ code: "NoSuchUpload", status: 404 }), head: vi.fn().mockRejectedValue({ status: 404 }) };
  return { path, state, methods, client: methods as unknown as OSS };
}

describe("uncertain remote write cleanup", () => {
  it("keeps an ambiguous Complete on disk until its actual object can be confirmed", async () => {
    const { path, state, methods, client } = await fixture();
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(settleStorageWrite(client, path, "jobs/test/")).rejects.toBeInstanceOf(StorageCleanupError);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(state);
    methods.head.mockResolvedValue({ res: { headers: { "x-oss-meta-koma-upload-id": state.marker, "content-length": "1024" } } });
    await settleStorageWrite(client, path, "jobs/test/");
    expect(await hasStorageWrite(path)).toBe(false);
  });

  it("accepts NoSuchUpload before Complete could have been sent", async () => {
    const { path, methods, client } = await fixture("parts");
    await settleStorageWrite(client, path, "jobs/test/");
    expect(await hasStorageWrite(path)).toBe(false);
    expect(methods.head).not.toHaveBeenCalled();
  });

  it.each([{}, { code: "NoSuchBucket" }, { code: "NoSuchKey" }])("does not treat an unrelated abort 404 as confirmed cleanup: %j", async error => {
    const { path, methods, client } = await fixture("parts");
    methods.abortMultipartUpload.mockRejectedValue({ status: 404, ...error });
    await expect(settleStorageWrite(client, path, "jobs/test/")).rejects.toBeInstanceOf(StorageCleanupError);
    expect(await hasStorageWrite(path)).toBe(true);
  });

  it("does not guess an ID when initialization never returned one", async () => {
    const { path, state, methods, client } = await fixture("parts");
    delete state.uploadId;
    await saveStorageWrite(path, state);
    await settleStorageWrite(client, path, "jobs/test/");
    expect(methods.abortMultipartUpload).not.toHaveBeenCalled();
    expect(await hasStorageWrite(path)).toBe(false);
  });

  it("clears an explicitly aborted upload", async () => {
    const { path, methods, client } = await fixture();
    methods.abortMultipartUpload.mockResolvedValue({ res: { status: 204 } });
    await settleStorageWrite(client, path, "jobs/test/");
    expect(await hasStorageWrite(path)).toBe(false);
  });

  it("retains a pending small PUT if HEAD cannot establish its outcome", async () => {
    const { path, state, methods, client } = await fixture();
    delete state.uploadId;
    await saveStorageWrite(path, state);
    methods.head.mockResolvedValue({ res: { headers: { "x-oss-meta-koma-upload-id": "some-other-upload", "content-length": "1024" } } });
    await expect(settleStorageWrite(client, path, "jobs/test/")).rejects.toMatchObject({ statusCode: 503 });
    expect(await hasStorageWrite(path)).toBe(true);
  });

  it.each(["malformed", "another-prefix"])("keeps invalid journal data without touching other objects (%s)", async invalid => {
    const { path, state, methods, client } = await fixture();
    await writeFile(path, invalid === "malformed" ? "not-json" : JSON.stringify({ ...state, key: "jobs/another/video.mp4" }));
    await expect(settleStorageWrite(client, path, "jobs/test/")).rejects.toMatchObject({ statusCode: 503 });
    expect(methods.head).not.toHaveBeenCalled();
    expect(methods.abortMultipartUpload).not.toHaveBeenCalled();
    expect(await hasStorageWrite(path)).toBe(true);
  });

  it.each([
    { key: "jobs/test/../other/video.mp4" },
    { key: "jobs/test/\\other.mp4" },
    { key: "jobs/test//video.mp4" },
    { key: "jobs/test/video\n.mp4" },
    { marker: { untrusted: true } },
    { uploadId: ["untrusted"] }
  ])("rejects malformed object identity before making any OSS request: %j", async patch => {
    const { path, state, methods, client } = await fixture();
    await writeFile(path, JSON.stringify({ ...state, ...patch }));
    await expect(settleStorageWrite(client, path, "jobs/test/")).rejects.toMatchObject({ statusCode: 503 });
    expect(methods.head).not.toHaveBeenCalled();
    expect(methods.abortMultipartUpload).not.toHaveBeenCalled();
  });
});
