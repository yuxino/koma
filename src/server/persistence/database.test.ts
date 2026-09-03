import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function loadSqliteDatabase() {
  const root = await mkdtemp(join(os.tmpdir(), "koma-database-test-"));
  cleanup.push(root);
  vi.stubEnv("DB_DRIVER", "sqlite");
  vi.stubEnv("KOMA_DATABASE_PATH", join(root, "koma.sqlite"));
  vi.resetModules();
  const database = await import("./database.js");
  await database.initializeDatabase();
  return database;
}

describe("database adapter", () => {
  it("uses SQLite by default and selects MySQL only through configuration", async () => {
    vi.stubEnv("DB_DRIVER", "sqlite");
    let database = await import("./database.js");
    expect(database.databaseDriver()).toBe("sqlite");
    vi.resetModules();
    vi.stubEnv("DB_DRIVER", "mysql");
    database = await import("./database.js");
    expect(database.databaseDriver()).toBe("mysql");
  });

  it("persists complete replay records without exposing settings through job history", async () => {
    const database = await loadSqliteDatabase();
    await database.writeSetting("provider_settings", "encrypted-payload", 1000);
    expect(await database.readSetting("provider_settings")).toBe("encrypted-payload");

    await database.writeJobRecord({
      id: "job-1", source: "upload", title: "demo.mp4", status: "queued", stage: "queued", percent: 4, detail: "queued",
      language: "zh", analysisSpec: { instruction: "提取商品" }, result: null,
      asrProvider: "groq", asrModel: "whisper", visionProvider: "openrouter", visionModel: "free",
      createdAt: 1000, updatedAt: 1000, completedAt: null, storagePrefix: "koma/jobs/job-1",
      inputObjectKey: null, inputMimeType: null, mediaAvailable: false, error: null
    });
    const ownerId = "a".repeat(64);
    await database.writeJobOwner("job-1", ownerId, 1000);
    expect(await database.readJobOwner("job-1")).toBe(ownerId);
    await database.markInterruptedJobs(1200);
    expect(await database.readJobRecord("job-1")).toMatchObject({ status: "failed", stage: "failed", percent: 100 });
    await database.writeJobRecord({
      id: "job-1", source: "upload", title: "demo.mp4", status: "done", stage: "done", percent: 100, detail: "done",
      language: "zh", analysisSpec: { instruction: "提取商品" }, result: { summary: "done", frames: [] },
      asrProvider: "groq", asrModel: "whisper", visionProvider: "openrouter", visionModel: "free",
      createdAt: 1000, updatedAt: 1500, completedAt: 1500, storagePrefix: "koma/jobs/job-1",
      inputObjectKey: "koma/jobs/job-1/video/source.mp4", inputMimeType: "video/mp4", mediaAvailable: true, error: null
    });
    const parseSpy = vi.spyOn(JSON, "parse");
    const history = await database.listJobHistory();
    const ownedHistory = await database.listOwnedJobHistory(ownerId);
    const parseCallCount = parseSpy.mock.calls.length;
    parseSpy.mockRestore();
    expect(parseCallCount).toBe(0);
    expect(history[0]).toMatchObject({ id: "job-1", status: "done", percent: 100, mediaAvailable: true, asrProvider: "groq" });
    expect(JSON.stringify(history)).not.toContain("encrypted-payload");
    expect(ownedHistory).toMatchObject([{ id: "job-1", status: "done" }]);
    expect(await database.listOwnedJobHistory("b".repeat(64))).toEqual([]);

    const replay = await database.readJobRecord("job-1");
    expect(replay).toMatchObject({ inputObjectKey: "koma/jobs/job-1/video/source.mp4", result: { summary: "done" } });
    await database.deleteJobRecord("job-1");
    expect(await database.listJobHistory()).toEqual([]);
    expect(await database.readJobOwner("job-1")).toBeNull();
    await database.closeDatabase();
  });
});
