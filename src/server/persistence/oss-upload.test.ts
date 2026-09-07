import { mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OSS from "ali-oss";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StorageWriteError, uploadOssObject } from "./oss-upload.js";
import { hasStorageWrite } from "./storage-write-journal.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: vi.fn(actual.stat) };
});

const SIZE = 9 * 1024 * 1024;
let root: string;
let input: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "koma-oss-upload-")); input = join(root, "input.mp4"); await writeFile(input, "video"); await truncate(input, SIZE); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
function client() {
  return { put: vi.fn().mockResolvedValue({}), multipartUpload: vi.fn().mockResolvedValue({}), completeMultipartUpload: vi.fn().mockResolvedValue({}), head: vi.fn().mockRejectedValue(new Error("NotFound")), abortMultipartUpload: vi.fn().mockResolvedValue({}), cancel: vi.fn() };
}
type Client = ReturnType<typeof client>;
function upload(oss: Client, source: string | Buffer = input, signal?: AbortSignal, journalPath?: string) {
  return uploadOssObject(oss as unknown as OSS, "jobs/test/video.mp4", source, "video/mp4", { signal, journalPath });
}
function timeout() { return Object.assign(new Error("Response timeout for 120000ms"), { name: "ResponseTimeoutError" }); }
function checkpoint(): OSS.Checkpoint { return { name: "jobs/test/video.mp4", file: input, fileSize: SIZE, partSize: 4 * 1024 * 1024, uploadId: "test-upload", doneParts: [] }; }

describe("bounded, private OSS writes", () => {
  it("streams large files as small serial parts and retains the source", async () => {
    const oss = client();
    await upload(oss);
    expect(oss.put).not.toHaveBeenCalled();
    expect(oss.multipartUpload).toHaveBeenCalledWith("jobs/test/video.mp4", input, expect.objectContaining({ partSize: 4 * 1024 * 1024, parallel: 1, mime: "video/mp4", headers: { "cache-control": "private, no-store", "x-oss-object-acl": "private" }, meta: { "koma-upload-id": expect.any(String) } }));
    expect((await readFile(input)).length).toBe(SIZE);
  });

  it("keeps small content on PUT with a fresh stable upload marker", async () => {
    const oss = client();
    await upload(oss, Buffer.from("small"));
    expect(oss.multipartUpload).not.toHaveBeenCalled();
    expect(oss.put.mock.calls[0][2]).toMatchObject({ headers: { "cache-control": "private, no-store", "x-oss-object-acl": "private" } });
  });

  it("resumes the captured checkpoint even when SDK timeout has no status", async () => {
    const oss = client(); const saved = checkpoint(); saved.doneParts.push({ number: 1, etag: "first-part" });
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => { await options.progress(0.3, saved); throw timeout(); });
    await upload(oss);
    expect(oss.multipartUpload).toHaveBeenCalledTimes(2);
    expect(oss.multipartUpload.mock.calls[1][2].checkpoint).toBe(saved);
    expect(oss.multipartUpload.mock.calls[1][2].checkpoint.doneParts).toEqual([{ number: 1, etag: "first-part" }]);
    expect(oss.multipartUpload.mock.calls[1][2].meta).toEqual(oss.multipartUpload.mock.calls[0][2].meta);
    expect(oss.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("retries a failed initialization without inventing an upload ID", async () => {
    const oss = client(); oss.multipartUpload.mockRejectedValueOnce(timeout());
    await upload(oss);
    expect(oss.multipartUpload.mock.calls[1][2].checkpoint).toBeUndefined();
    expect(oss.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("bounds transient attempts, aborts the known upload, and preserves the useful error", async () => {
    const oss = client(); const saved = checkpoint();
    oss.multipartUpload.mockImplementation(async (_key, _source, options) => { await options.progress(0, saved); throw timeout(); });
    oss.abortMultipartUpload.mockRejectedValue(new Error("cleanup failed"));
    await expect(upload(oss)).rejects.toThrow("ResponseTimeoutError: Response timeout for 120000ms");
    expect(oss.multipartUpload).toHaveBeenCalledTimes(3);
    expect(oss.abortMultipartUpload).toHaveBeenCalledExactlyOnceWith("jobs/test/video.mp4", "test-upload");
    expect((await readFile(input)).length).toBe(SIZE);
  });

  it("does not retry a permission failure and removes URLs and credentials from its error", async () => {
    const oss = client();
    oss.put.mockRejectedValue(Object.assign(new Error("Access denied https://bucket.example/private-job?Signature=private-secret Authorization: OSS private-key:secret"), { name: "AccessDeniedError", code: "AccessDenied", status: 403 }));
    const error = await upload(oss, Buffer.from("small")).catch(error => error);
    expect(error).toBeInstanceOf(StorageWriteError);
    expect(error.message).toContain("AccessDenied");
    expect(error.message).toContain("403");
    expect(error.message).not.toMatch(/bucket\.example|private-job|private-secret|private-key/);
    expect(oss.put).toHaveBeenCalledOnce();
    expect(oss.head).not.toHaveBeenCalled();
  });

  it("recognizes a completed upload after a lost response using its marker and size", async () => {
    const oss = client();
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => {
      await options.progress(0.8, checkpoint());
      oss.head.mockResolvedValue({ res: { headers: { "x-oss-meta-koma-upload-id": options.meta["koma-upload-id"], "content-length": String(SIZE) } } });
      throw timeout();
    });
    await upload(oss);
    expect(oss.multipartUpload).toHaveBeenCalledOnce();
    expect(oss.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("sanitizes quoted credential fields without hiding the actual failure category", () => {
    const error = new StorageWriteError(Object.assign(new Error('{"accessKeySecret":"SYNTHETIC_SECRET","authorization":"SYNTHETIC_AUTH"}'), { code: "AccessDenied", status: 403 }), 1);
    expect(error.message).toContain("AccessDenied");
    expect(error.message).not.toMatch(/SYNTHETIC_SECRET|SYNTHETIC_AUTH/);
  });

  it("retries a transient small PUT without reusing a consumed stream", async () => {
    const oss = client(); const content = Buffer.from("complete small object");
    oss.put.mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { status: 503 }));
    await upload(oss, content);
    expect(oss.put).toHaveBeenCalledTimes(2);
    expect(oss.put.mock.calls[0][1]).toBe(content);
    expect(oss.put.mock.calls[1][1]).toBe(content);
  });

  it.each(["wrong-marker", "wrong-size"])("does not accept an unrelated or incomplete object (%s)", async mismatch => {
    const oss = client();
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => {
      await options.progress(0, checkpoint());
      oss.head.mockResolvedValue({ res: { headers: { "x-oss-meta-koma-upload-id": mismatch === "wrong-marker" ? "another-write" : options.meta["koma-upload-id"], "content-length": mismatch === "wrong-size" ? String(SIZE - 1) : String(SIZE) } } });
      throw timeout();
    }).mockRejectedValueOnce(Object.assign(new Error("No such upload"), { code: "NoSuchUpload", status: 404 }));
    await expect(upload(oss)).rejects.toThrow("NoSuchUpload");
    expect(oss.multipartUpload).toHaveBeenCalledTimes(2);
    expect(oss.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  it("checks completion again when a resumed upload ID has already been consumed", async () => {
    const oss = client(); let token = "";
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => { token = options.meta["koma-upload-id"]; await options.progress(0.8, checkpoint()); throw timeout(); })
      .mockImplementationOnce(async () => { oss.head.mockResolvedValue({ res: { headers: { "x-oss-meta-koma-upload-id": token, "content-length": String(SIZE) } } }); throw Object.assign(new Error("No such upload"), { code: "NoSuchUpload" }); });
    await upload(oss);
    expect(oss.multipartUpload).toHaveBeenCalledTimes(2);
    expect(oss.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it("never starts an already canceled upload", async () => {
    const oss = client(); const controller = new AbortController(); controller.abort();
    await expect(upload(oss, input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(oss.multipartUpload).not.toHaveBeenCalled();
  });

  it("gives cancellation priority over stream errors and aborts only after the upload settles", async () => {
    const oss = client(); const controller = new AbortController(); let settled = false;
    oss.multipartUpload.mockImplementation(async (_key, _source, options) => { await options.progress(0, checkpoint()); controller.abort(); settled = true; throw timeout(); });
    oss.abortMultipartUpload.mockImplementation(async () => { expect(settled).toBe(true); });
    await expect(upload(oss, input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(oss.cancel).toHaveBeenCalledOnce();
    expect(oss.multipartUpload).toHaveBeenCalledOnce();
    expect(oss.abortMultipartUpload).toHaveBeenCalledOnce();
    expect(oss.head).not.toHaveBeenCalled();
  });

  it("refuses to resume if the local source changes", async () => {
    const altered = join(root, "input.webm"); await writeFile(altered, "video"); await truncate(altered, SIZE);
    const oss = client();
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => { await options.progress(0, checkpoint()); await truncate(altered, SIZE - 1); throw timeout(); });
    await expect(upload(oss, altered)).rejects.toThrow("上传来源已改变");
    expect(oss.multipartUpload).toHaveBeenCalledOnce();
    expect(oss.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  it("records the committing phase before SDK Complete is allowed to run", async () => {
    const oss = client(); const journal = join(root, "complete-journal.json");
    const complete = oss.completeMultipartUpload;
    complete.mockImplementationOnce(async () => {
      expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ phase: "committing", uploadId: "test-upload" });
    });
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => {
      expect(JSON.parse(await readFile(journal, "utf8")).phase).toBe("parts");
      const saved = checkpoint(); saved.doneParts = [1, 2, 3].map(number => ({ number, etag: String(number) }));
      await options.progress(0.75, saved);
      expect(JSON.parse(await readFile(journal, "utf8")).phase).toBe("parts");
      await oss.completeMultipartUpload(saved.name, saved.uploadId, saved.doneParts, options);
    });
    await upload(oss, input, undefined, journal);
    expect(complete).toHaveBeenCalledOnce();
    expect(oss.completeMultipartUpload).toBe(complete);
    expect(await hasStorageWrite(journal)).toBe(false);
  });

  it("never completes a multipart checkpoint with missing parts", async () => {
    const oss = client(); const complete = oss.completeMultipartUpload;
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => {
      const saved = checkpoint(); saved.doneParts = [{ number: 1, etag: "first" }, { number: 3, etag: "last" }];
      await options.progress(0.5, saved);
      await oss.completeMultipartUpload(saved.name, saved.uploadId, saved.doneParts, options);
    });
    await expect(upload(oss)).rejects.toThrow("InvalidCheckpointError");
    expect(complete).not.toHaveBeenCalled();
    expect(oss.abortMultipartUpload).toHaveBeenCalledOnce();
  });

  it("keeps the known multipart ID when a denied part cannot be aborted", async () => {
    const oss = client(); const journal = join(root, "abort-denied-journal.json");
    const denied = Object.assign(new Error("Access denied"), { code: "AccessDenied", status: 403 });
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => { const saved = checkpoint(); saved.doneParts.push({ number: 1, etag: "part-one" }); await options.progress(0.25, saved); throw denied; });
    oss.abortMultipartUpload.mockRejectedValue(denied);
    await expect(upload(oss, input, undefined, journal)).rejects.toThrow("AccessDenied");
    expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ uploadId: "test-upload", phase: "parts" });
  });

  it("clears a failed small PUT journal when connections were definitively never established", async () => {
    const oss = client(); const journal = join(root, "connect-journal.json");
    oss.put.mockRejectedValue(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }));
    await expect(upload(oss, Buffer.from("small"), undefined, journal)).rejects.toThrow("ECONNREFUSED");
    expect(oss.put).toHaveBeenCalledTimes(3);
    expect(await hasStorageWrite(journal)).toBe(false);
  });

  it("does not forget an earlier ambiguous PUT just because a later connection fails", async () => {
    const oss = client(); const journal = join(root, "ambiguous-put-journal.json");
    oss.put.mockRejectedValueOnce(timeout()).mockRejectedValue(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }));
    await expect(upload(oss, Buffer.from("small"), undefined, journal)).rejects.toThrow("ECONNREFUSED");
    expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ phase: "committing", size: 5 });
  });

  it("retains a canceled second PUT after a definitive first connection failure", async () => {
    const oss = client(); const journal = join(root, "cancel-after-connect-journal.json"); const controller = new AbortController();
    oss.put.mockRejectedValueOnce(Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" }))
      .mockImplementationOnce(async () => { controller.abort(); throw timeout(); });
    await expect(upload(oss, Buffer.from("small"), controller.signal, journal)).rejects.toMatchObject({ name: "AbortError" });
    expect(oss.put).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(journal, "utf8"))).toMatchObject({ phase: "committing", size: 5 });
  });

  it("does not treat an arbitrary abort 404 as a removed multipart upload", async () => {
    const oss = client(); const journal = join(root, "abort-404-journal.json");
    oss.multipartUpload.mockImplementationOnce(async (_key, _source, options) => { await options.progress(0, checkpoint()); throw Object.assign(new Error("Denied"), { status: 403 }); });
    oss.abortMultipartUpload.mockRejectedValue({ code: "NoSuchBucket", status: 404 });
    await expect(upload(oss, input, undefined, journal)).rejects.toThrow("Denied");
    expect(await hasStorageWrite(journal)).toBe(true);
  });

  it("does not start or retain a small PUT when canceled during its final file check", async () => {
    const oss = client(); const controller = new AbortController(); const journal = join(root, "canceled-put-journal.json");
    const small = join(root, "input.mov"); await writeFile(small, "small");
    const info = await stat(small);
    vi.mocked(stat).mockResolvedValueOnce(info).mockImplementationOnce(async () => { controller.abort(); return info; });
    await expect(upload(oss, small, controller.signal, journal)).rejects.toMatchObject({ name: "AbortError" });
    expect(oss.put).not.toHaveBeenCalled();
    expect(oss.multipartUpload).not.toHaveBeenCalled();
    expect(await hasStorageWrite(journal)).toBe(false);
  });

  it("does not disclose local file paths when the source cannot be read", async () => {
    const oss = client();
    vi.mocked(stat).mockRejectedValueOnce(new Error("EACCES /private/server/video.mp4"));
    const error = await upload(oss).catch(error => error);
    expect(error.name).toBe("UploadSourceError");
    expect(error.message).not.toContain("/private/server/");
    expect(oss.put).not.toHaveBeenCalled();
  });
});
