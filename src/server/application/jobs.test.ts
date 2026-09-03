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
});
