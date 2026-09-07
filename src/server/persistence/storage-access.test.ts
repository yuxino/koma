import { afterEach, describe, expect, it, vi } from "vitest";

const oss = vi.hoisted(() => ({ put: vi.fn(), listV2: vi.fn(), putACL: vi.fn(), signatureUrl: vi.fn(), get: vi.fn() }));
vi.mock("ali-oss", () => ({ default: class { put = oss.put; listV2 = oss.listV2; putACL = oss.putACL; signatureUrl = oss.signatureUrl; get = oss.get; } }));
afterEach(() => { vi.resetAllMocks(); vi.resetModules(); vi.unstubAllEnvs(); });
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
    await module.putStoredFile("koma/jobs/one/video.mp4", "/tmp/not-opened-by-mock.mp4", "video/mp4");
    await module.putStoredText("koma/jobs/one/result.json", "{}", "application/json");
    for (const call of oss.put.mock.calls) expect(call[2].headers).toEqual({ "cache-control": "private, no-store", "x-oss-object-acl": "private" });
  });

  it("does not use configured permanent public URLs for private HTTP resources", async () => {
    const module = await storage();
    vi.stubEnv("OSS_PUBLIC_BASE_URL", "https://public.example");
    oss.signatureUrl.mockReturnValue("https://signed.example/short-lived");
    expect(await module.storedObjectInfo("koma/jobs/one/video.mp4", { private: true })).toEqual({ url: "https://signed.example/short-lived" });
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
