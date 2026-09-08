import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const baseRoot = await mkdtemp(join(os.tmpdir(), "koma-jobs-test-"));

// 每个用例用独立的 TEMP_ROOT 重新加载模块，隔离任务目录，避免用例互相污染。
async function loadJobs() {
  const runRoot = await mkdtemp(join(baseRoot, "run-"));
  vi.stubEnv("TEMP_ROOT", runRoot);
  vi.stubEnv("DB_DRIVER", "sqlite");
  vi.stubEnv("KOMA_DATABASE_PATH", join(runRoot, "test.sqlite"));
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("LOCAL_STORAGE_PATH", join(runRoot, "storage"));
  vi.resetModules();
  return await import("./jobs.js");
}

afterAll(async () => {
  await rm(baseRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe("job lifecycle cleanup", () => {
  it("createJob creates its working directory and registers the job", async () => {
    const { createJob, deleteJob, getJob } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4" });
    await expect(stat(job.dir)).resolves.toBeTruthy();
    expect(getJob(job.id)).toBe(job);
    await deleteJob(job.id);
  });

  it("stores and serializes a custom analysis specification", async () => {
    const { createJob, deleteJob, serializeJob } = await loadJobs();
    const analysisSpec = { instruction: "提取商品", outputSchema: { products: [] }, artifactFormats: ["json" as const] };
    const job = await createJob({ source: "upload", title: "a.mp4", language: "en", analysisSpec });
    expect(job.analysisSpec).toEqual(analysisSpec);
    expect(serializeJob(job)?.analysisSpec).toEqual(analysisSpec);
    expect(serializeJob(job)?.language).toBe("en");
    await deleteJob(job.id);
  });

  it("keeps an accountless owner digest on a persisted job without serializing it", async () => {
    const { createJob, deleteJob, serializeJob } = await loadJobs();
    const ownerId = "c".repeat(64);
    const job = await createJob({ source: "upload", title: "owned.mp4", ownerId });
    expect(job.ownerId).toBe(ownerId);
    expect(serializeJob(job)).not.toHaveProperty("ownerId");
    await deleteJob(job.id);
  });

  it("restores account ownership and retry source after a process reload without serializing the source URL", async () => {
    const { createJob, serializeJob } = await loadJobs();
    const database = await import("../persistence/database.js");
    await database.saveAccount({ id: "123", login: "test-user", name: null, avatarUrl: "https://avatars.githubusercontent.com/u/123" });
    const sourceUrl = "https://example.com/video.mp4?signature=private-source";
    const job = await createJob({ source: "url", title: "retry me", accountId: "123", sourceUrl });
    expect(JSON.stringify(serializeJob(job))).not.toContain("private-source");
    await database.closeDatabase();
    vi.resetModules();
    const reloaded = await import("./jobs.js");
    expect(await reloaded.loadJob(job.id)).toMatchObject({ accountId: "123", sourceUrl });
    await reloaded.deleteJob(job.id);
  });

  it("serializes artifact metadata without embedding file content", async () => {
    const { createJob, deleteJob, serializeJob, updateJob } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4" });
    updateJob(job, {
      status: "done",
      result: {
        title: "report",
        durationMs: 1000,
        summary: "summary",
        tags: [],
        chapters: [],
        transcript: [],
        frames: [],
        artifacts: [{ id: "0", name: "report.md", format: "markdown", mimeType: "text/markdown; charset=utf-8", content: "# report", sizeBytes: 8, storageKey: `${job.storagePrefix}/artifacts/0-report.md` }]
      }
    });
    const serialized = serializeJob(job) as { result?: { artifacts?: Array<Record<string, unknown>> } };
    expect(serialized.result?.artifacts?.[0]).toMatchObject({ name: "report.md", downloadUrl: `/api/jobs/${job.id}/artifacts/0` });
    expect(serialized.result?.artifacts?.[0]).not.toHaveProperty("content");
    expect(serialized.result?.artifacts?.[0]).not.toHaveProperty("storageKey");
    await deleteJob(job.id);
  });

  it("never serializes task-level provider API keys", async () => {
    const { createJob, deleteJob, serializeJob } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4", providers: {
      asr: { provider: "groq", apiKey: "private-asr-key", baseUrl: "https://api.groq.com/openai/v1", model: "whisper" },
      vision: { provider: "openrouter", apiKey: "private-vision-key", baseUrl: "https://openrouter.ai/api/v1", model: "free" }
    } });
    const serialized = JSON.stringify(serializeJob(job));
    expect(serialized).toContain("openrouter");
    expect(serialized).not.toContain("private-asr-key");
    expect(serialized).not.toContain("private-vision-key");
    await deleteJob(job.id);
  });

  it("deleteJob removes the job directory from disk", async () => {
    const { createJob, deleteJob, getJob } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4" });
    await writeFile(join(job.dir, "input.mp4"), "video");
    await deleteJob(job.id);
    expect(getJob(job.id)).toBeUndefined();
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it("keeps a failed complete source through finalization and reload, but deletes it with its job", async () => {
    const { createJob, releaseWorkingDirectory, updateJob, serializeJob } = await loadJobs();
    const { retainRetrySource, retainedInputPath } = await import("./retry-source.js");
    const job = await createJob({ source: "upload", title: "retained.mp4" });
    job.inputPath = join(job.dir, "input.mp4");
    await writeFile(job.inputPath, "complete source");
    await retainRetrySource(job);
    updateJob(job, { status: "failed", error: "Storage write failed" });
    await releaseWorkingDirectory(job);
    expect(await retainedInputPath(job)).toBe(job.inputPath);
    expect(JSON.stringify(serializeJob(job))).not.toContain("localRetrySource");
    await (await import("../persistence/database.js")).closeDatabase();
    vi.resetModules();
    const reloaded = await import("./jobs.js");
    const restored = await reloaded.loadJob(job.id);
    expect(await retainedInputPath(restored!)).toBe(job.inputPath);
    await reloaded.deleteJob(job.id);
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it("deleteJob removes URL-job working data", async () => {
    const { createJob, deleteJob, getJob } = await loadJobs();
    const job = await createJob({ source: "url", title: "https://example.com/a.mp4" });
    await writeFile(join(job.dir, "input.mp4"), "video");
    await deleteJob(job.id);
    expect(getJob(job.id)).toBeUndefined();
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it("deleteJob aborts the job's signal so in-flight pipelines stop", async () => {
    const { createJob, deleteJob, getJobAbortSignal } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4" });
    const signal = getJobAbortSignal(job.id);
    expect(signal?.aborted).toBe(false);
    await deleteJob(job.id);
    expect(signal?.aborted).toBe(true);
  });

  it("expiring an unknown job is a no-op", async () => {
    const { deleteJob } = await loadJobs();
    await expect(deleteJob("does-not-exist")).resolves.toBeUndefined();
  });

  it("deleteJob permanently removes a processing job", async () => {
    const { createJob, deleteJob, getJobAbortSignal } = await loadJobs();
    const job = await createJob({ source: "upload", title: "a.mp4" });
    const signal = getJobAbortSignal(job.id);
    await deleteJob(job.id);
    expect(signal?.aborted).toBe(true);
    await expect(stat(job.dir)).rejects.toThrow();
  });

  it("ignores delayed updates after deletion instead of recreating an unowned record", async () => {
    const { createJob, deleteJob, updateJob, flushJob } = await loadJobs();
    const database = await import("../persistence/database.js");
    const job = await createJob({ source: "upload", title: "private.mp4" });
    await deleteJob(job.id);
    updateJob(job, { title: "late resolver title", status: "processing" });
    await flushJob(job);
    expect(await database.readJobRecord(job.id)).toBeNull();
    expect(job.title).toBe("private.mp4");
  });

  it("does not refill the cache from a read that started before deletion", async () => {
    const first = await loadJobs();
    const originalDatabase = await import("../persistence/database.js");
    await originalDatabase.saveAccount({ id: "123", login: "owner", name: null, avatarUrl: "https://avatars.githubusercontent.com/u/123" });
    const job = await first.createJob({ source: "upload", title: "private.mp4", accountId: "123" });
    await originalDatabase.closeDatabase();
    vi.resetModules();
    const jobs = await import("./jobs.js");
    const database = await import("../persistence/database.js");
    const owner = Promise.withResolvers<string | null>();
    const readOwner = vi.spyOn(database, "readJobOwner").mockImplementationOnce(() => owner.promise);
    const loading = jobs.loadJob(job.id);
    await vi.waitFor(() => expect(readOwner).toHaveBeenCalledOnce());
    try {
      await jobs.deleteJob(job.id);
      owner.resolve(null);
      expect(await loading).toBeUndefined();
      expect(jobs.getJob(job.id)).toBeUndefined();
      expect(await jobs.loadJob(job.id)).toBeUndefined();
      expect(await database.readJobRecord(job.id)).toBeNull();
    } finally {
      owner.resolve(null);
      await loading;
      readOwner.mockRestore();
    }
  });

  it("shares one live job between overlapping loads so updates keep their identity", async () => {
    const first = await loadJobs();
    const job = await first.createJob({ source: "upload", title: "saved.mp4" });
    await (await import("../persistence/database.js")).closeDatabase();
    vi.resetModules();
    const jobs = await import("./jobs.js");
    const [left, right] = await Promise.all([jobs.loadJob(job.id), jobs.loadJob(job.id)]);
    expect(left).toBeDefined();
    expect(left).toBe(right);
    jobs.updateJob(left!, { title: "updated by either reader" });
    await jobs.flushJob(right!);
    expect(await (await import("../persistence/database.js")).readJobRecord(job.id)).toMatchObject({ title: "updated by either reader" });
    await jobs.deleteJob(job.id);
  });
});
