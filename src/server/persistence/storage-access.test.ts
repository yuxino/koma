import { afterEach, describe, expect, it, vi } from "vitest";
import { contentDisposition } from "./artifacts.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const oss = vi.hoisted(() => ({ construct: vi.fn(), put: vi.fn(), listV2: vi.fn(), putACL: vi.fn(), signatureUrl: vi.fn(), get: vi.fn(), cancel: vi.fn() }));
vi.mock("ali-oss", () => ({ default: class { constructor(options: unknown) { oss.construct(options); } put = oss.put; listV2 = oss.listV2; putACL = oss.putACL; signatureUrl = oss.signatureUrl; get = oss.get; cancel = oss.cancel; } }));
const cleanup: string[] = [];
afterEach(async () => { vi.resetAllMocks(); vi.resetModules(); vi.unstubAllEnvs(); await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function storage() {
  vi.stubEnv("STORAGE_DRIVER", "oss");
  vi.stubEnv("OSS_REGION", "test-region");
  vi.stubEnv("OSS_BUCKET", "test-bucket");
  vi.stubEnv("OSS_ACCESS_KEY_ID", "test-id");
  vi.stubEnv("OSS_ACCESS_KEY_SECRET", "test-secret");
  return import("./storage.js");
}

describe("private OSS object access", () => {
  it("writes private ACL at upload time even when the shared bucket is public", async () => {
    const module = await storage();
    const root = await mkdtemp(join(tmpdir(), "koma-oss-access-")); cleanup.push(root);
    const input = join(root, "input.mp4"); await writeFile(input, "video");
    await module.putStoredFile("koma/jobs/one/video.mp4", input, "video/mp4");
    await module.putStoredText("koma/jobs/one/result.json", "{}", "application/json");
    for (const call of oss.put.mock.calls) expect(call[2].headers).toEqual({ "cache-control": "private, no-store", "x-oss-object-acl": "private" });
    expect(oss.construct).toHaveBeenCalledTimes(2);
    for (const call of oss.construct.mock.calls) expect(call[0]).toMatchObject({ retryMax: 0, timeout: 120000 });
  });

  it("does not use configured permanent public URLs for private HTTP resources", async () => {
    const module = await storage();
    vi.stubEnv("OSS_PUBLIC_BASE_URL", "https://public.example");
    oss.signatureUrl.mockReturnValue("https://signed.example/short-lived");
    expect(await module.storedObjectInfo("koma/jobs/one/video.mp4", { private: true })).toEqual({ url: "https://signed.example/short-lived" });
    expect(oss.signatureUrl).toHaveBeenCalledOnce();
  });

  it("waits for an in-flight write before listing objects for deletion", async () => {
    const module = await storage(); let finish!: () => void;
    oss.put.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    oss.listV2.mockResolvedValue({ objects: [], isTruncated: false });
    const writing = module.putStoredText("koma/jobs/one/result.json", "{}", "application/json");
    await vi.waitFor(() => expect(oss.put).toHaveBeenCalledOnce());
    const deleting = module.deleteStoredPrefix("koma/jobs/one");
    await Promise.resolve();
    expect(oss.listV2).not.toHaveBeenCalled();
    finish();
    await Promise.all([writing, deleting]);
    expect(oss.listV2).toHaveBeenCalledOnce();
  });

  it.each(["report.md", "工作区笔记 (复习).md"])("signs the attachment response header for %s instead of navigating to inline text", async (filename) => {
    const module = await storage();
    vi.stubEnv("OSS_PUBLIC_BASE_URL", "https://public.example");
    oss.signatureUrl.mockReturnValue("https://signed.example/download");
    const disposition = contentDisposition(filename);
    await module.storedObjectInfo("koma/jobs/one/report.md", { private: true, contentDisposition: disposition });
    expect(oss.signatureUrl).toHaveBeenCalledWith("koma/jobs/one/report.md", expect.objectContaining({
      method: "GET", response: { "content-disposition": disposition }
    }));
    expect(disposition).toMatch(/^attachment;/);
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe(filename);
  });

  it("keeps video and frame signed URLs inline without download overrides", async () => {
    const module = await storage();
    for (const key of ["koma/jobs/one/video.mp4", "koma/jobs/one/frame.jpg"]) await module.storedObjectInfo(key, { private: true });
    expect(oss.signatureUrl).toHaveBeenCalledTimes(2);
    for (const call of oss.signatureUrl.mock.calls) expect(call[1]).not.toHaveProperty("response");
  });

  it("signs attachment overrides even when callers use a configured public base URL", async () => {
    const module = await storage();
    vi.stubEnv("OSS_PUBLIC_BASE_URL", "https://public.example");
    await module.storedObjectInfo("koma/jobs/one/report.md", { contentDisposition: contentDisposition("report.md") });
    expect(oss.signatureUrl).toHaveBeenCalledOnce();
  });

  it("privatizes every object across pages before a legacy claim may proceed", async () => {
    const module = await storage();
    oss.listV2.mockResolvedValueOnce({ objects: [{ name: "koma/jobs/one/video.mp4" }], isTruncated: true, nextContinuationToken: "next" })
      .mockResolvedValueOnce({ objects: [{ name: "koma/jobs/one/frame.jpg" }, { name: "koma/jobs/one/result.json" }], isTruncated: false });
    await module.makeStoredPrefixPrivate("koma/jobs/one");
    expect(oss.listV2.mock.calls[1][0]).toMatchObject({ prefix: "koma/jobs/one/", "continuation-token": "next" });
    expect(oss.putACL.mock.calls).toEqual([["koma/jobs/one/video.mp4", "private"], ["koma/jobs/one/frame.jpg", "private"], ["koma/jobs/one/result.json", "private"]]);
  });

  it("propagates an ACL failure so ownership is not claimed under a false privacy guarantee", async () => {
    const module = await storage();
    oss.listV2.mockResolvedValue({ objects: [{ name: "koma/jobs/one/video.mp4" }], isTruncated: false });
    oss.putACL.mockRejectedValue(new Error("AccessDenied"));
    await expect(module.makeStoredPrefixPrivate("koma/jobs/one")).rejects.toThrow("AccessDenied");
  });
});
