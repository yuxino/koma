import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ putStoredFile: vi.fn(), putStoredText: vi.fn(), deleteStoredPrefix: vi.fn(), jobStoragePrefix: (id: string) => `koma/jobs/${id}` }));
const media = vi.hoisted(() => ({ inspectVideo: vi.fn(), downloadUrl: vi.fn(), resolveVideoUrl: vi.fn() }));
vi.mock("../persistence/storage.js", () => storage);
vi.mock("../media/video.js", () => ({ inspectVideo: media.inspectVideo }));
vi.mock("../media/download.js", () => ({ downloadUrl: media.downloadUrl }));
vi.mock("../media/resolver.js", () => ({ resolveVideoUrl: media.resolveVideoUrl }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "koma-pipeline-storage-"));
  vi.stubEnv("TEMP_ROOT", root); vi.stubEnv("DB_DRIVER", "sqlite"); vi.stubEnv("KOMA_DATABASE_PATH", join(root, "test.sqlite"));
  vi.stubEnv("ASR_PROVIDER", "mock"); vi.stubEnv("VISION_PROVIDER", "mock"); vi.stubEnv("STORAGE_DRIVER", "local");
  vi.resetModules();
  media.resolveVideoUrl.mockResolvedValue({ url: "https://example.com/public-fixture.mp4" });
});
afterEach(async () => { await (await import("../persistence/database.js")).closeDatabase(); vi.resetAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("pipeline storage failure recovery", () => {
  it("does not restart a job deleted before its scheduled analysis begins", async () => {
    const jobs = await import("./jobs.js");
    const database = await import("../persistence/database.js");
    const { enqueueAnalysis } = await import("./pipeline.js");
    const job = await jobs.createJob({ source: "upload", title: "deleted.mp4" });
    await jobs.deleteJob(job.id);
    enqueueAnalysis(job);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await jobs.flushJob(job);
    expect(await database.readJobRecord(job.id)).toBeNull();
    expect(storage.putStoredFile).not.toHaveBeenCalled();
  });

  it("ignores a resolver result that arrives after its job was deleted", async () => {
    const jobs = await import("./jobs.js");
    const release = vi.spyOn(jobs, "releaseWorkingDirectory");
    const database = await import("../persistence/database.js");
    const resolved = Promise.withResolvers<{ url: string; title: string }>();
    media.resolveVideoUrl.mockReturnValueOnce(resolved.promise);
    const job = await jobs.createJob({ source: "url", title: "deleted", sourceUrl: "https://example.com/fixture" });
    (await import("./pipeline.js")).enqueueAnalysis(job);
    await vi.waitFor(() => expect(media.resolveVideoUrl).toHaveBeenCalledOnce());
    await jobs.deleteJob(job.id);
    resolved.resolve({ url: "https://example.com/video.mp4", title: "late result" });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await release.mock.results[0].value;
    expect(await database.readJobRecord(job.id)).toBeNull();
    expect(media.downloadUrl).not.toHaveBeenCalled();
  });

  it("retains only a complete input when OSS storage fails, after normal finalization", async () => {
    const jobs = await import("./jobs.js");
    const release = vi.spyOn(jobs, "releaseWorkingDirectory");
    const { StorageWriteError } = await import("../persistence/oss-upload.js");
    storage.putStoredFile.mockRejectedValue(new StorageWriteError(Object.assign(new Error("Response timeout for 120000ms"), { name: "ResponseTimeoutError" }), 3));
    const job = await jobs.createJob({ source: "upload", title: "synthetic.mp4" });
    job.inputPath = join(job.dir, "input.mp4"); await writeFile(job.inputPath, "complete synthetic source");
    (await import("./pipeline.js")).enqueueAnalysis(job);
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await release.mock.results[0].value;
    expect(job.status).toBe("failed");
    expect(await readFile(job.inputPath!, "utf8")).toBe("complete synthetic source");
    expect(await (await import("./retry-source.js")).retainedInputPath(job)).toBe(job.inputPath);
    expect(media.inspectVideo).not.toHaveBeenCalled();
    await jobs.deleteJob(job.id);
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it("does not preserve a partially downloaded source as a retryable upload", async () => {
    const jobs = await import("./jobs.js");
    const release = vi.spyOn(jobs, "releaseWorkingDirectory");
    media.downloadUrl.mockImplementation(async (_url, target) => { await writeFile(target, "partial source"); throw new Error("Download interrupted"); });
    const job = await jobs.createJob({ source: "url", title: "synthetic.mp4", sourceUrl: "https://example.com/public-fixture.mp4" });
    (await import("./pipeline.js")).enqueueAnalysis(job);
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    await release.mock.results[0].value;
    expect(job.status).toBe("failed");
    expect(storage.putStoredFile).not.toHaveBeenCalled();
    await expect(stat(job.dir)).rejects.toThrow();
    await jobs.deleteJob(job.id);
  });

  it("preserves a job and its directory when remote deletion cannot be confirmed", async () => {
    const jobs = await import("./jobs.js");
    const database = await import("../persistence/database.js");
    const job = await jobs.createJob({ source: "upload", title: "synthetic.mp4" });
    storage.deleteStoredPrefix.mockRejectedValueOnce(new Error("Unconfirmed remote cleanup"));
    await expect(jobs.deleteJob(job.id)).rejects.toMatchObject({ statusCode: 503 });
    expect(jobs.getJob(job.id)).toBe(job);
    expect(await database.readJobRecord(job.id)).not.toBeNull();
    await expect(stat(job.dir)).resolves.toBeTruthy();
    storage.deleteStoredPrefix.mockResolvedValueOnce(undefined);
    await jobs.deleteJob(job.id);
    expect(await database.readJobRecord(job.id)).toBeNull();
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it.each(["during deletion", "after deletion fails"])("preserves recovery files when canceled analysis finishes %s", async (timing) => {
    const jobs = await import("./jobs.js");
    const release = vi.spyOn(jobs, "releaseWorkingDirectory");
    const resolved = Promise.withResolvers<{ url: string }>();
    const cleanup = Promise.withResolvers<void>();
    media.resolveVideoUrl.mockReturnValueOnce(resolved.promise);
    storage.deleteStoredPrefix.mockReturnValueOnce(cleanup.promise);
    const job = await jobs.createJob({ source: "url", title: "recover", sourceUrl: "https://example.com/fixture" });
    const evidence = join(job.dir, "recovery-fixture");
    await writeFile(evidence, "retain until deletion is confirmed");
    (await import("./pipeline.js")).enqueueAnalysis(job);
    await vi.waitFor(() => expect(media.resolveVideoUrl).toHaveBeenCalledOnce());
    const deletion = expect(jobs.deleteJob(job.id)).rejects.toMatchObject({ statusCode: 503 });
    await vi.waitFor(() => expect(storage.deleteStoredPrefix).toHaveBeenCalledOnce());
    const finishAnalysis = async () => {
      resolved.resolve({ url: "https://example.com/video.mp4" });
      await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
      await release.mock.results[0].value;
      expect(await readFile(evidence, "utf8")).toBe("retain until deletion is confirmed");
    };
    if (timing === "during deletion") await finishAnalysis();
    cleanup.reject(new Error("Unconfirmed remote cleanup"));
    await deletion;
    if (timing === "after deletion fails") await finishAnalysis();
    expect(await readFile(evidence, "utf8")).toBe("retain until deletion is confirmed");
    expect(job.status).toBe("failed");
    jobs.updateJob(job, { status: "processing", title: "late update after cancellation" });
    expect(job.status).toBe("failed");
    expect(job.title).toBe("recover");
    await jobs.deleteJob(job.id);
    await expect(stat(job.dir)).rejects.toThrow();
  });
});
