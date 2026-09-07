import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ putStoredFile: vi.fn(), putStoredText: vi.fn(), deleteStoredPrefix: vi.fn(), jobStoragePrefix: (id: string) => `koma/jobs/${id}` }));
const media = vi.hoisted(() => ({ inspectVideo: vi.fn(), downloadUrl: vi.fn() }));
vi.mock("../persistence/storage.js", () => storage);
vi.mock("../media/video.js", () => ({ inspectVideo: media.inspectVideo }));
vi.mock("../media/download.js", () => ({ downloadUrl: media.downloadUrl }));
vi.mock("../media/resolver.js", () => ({ resolveVideoUrl: async () => ({ url: "https://example.com/public-fixture.mp4" }) }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "koma-pipeline-storage-"));
  vi.stubEnv("TEMP_ROOT", root); vi.stubEnv("DB_DRIVER", "sqlite"); vi.stubEnv("KOMA_DATABASE_PATH", join(root, "test.sqlite"));
  vi.stubEnv("ASR_PROVIDER", "mock"); vi.stubEnv("VISION_PROVIDER", "mock"); vi.stubEnv("STORAGE_DRIVER", "local");
  vi.resetModules();
});
afterEach(async () => { await (await import("../persistence/database.js")).closeDatabase(); vi.resetAllMocks(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("pipeline storage failure recovery", () => {
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
});
