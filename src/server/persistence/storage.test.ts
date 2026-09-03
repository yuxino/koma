import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const cleanup: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("persistent storage", () => {
  it("stores, reads, serves, and deletes a local job prefix", async () => {
    const root = await mkdtemp(join(os.tmpdir(), "koma-storage-test-"));
    cleanup.push(root);
    vi.stubEnv("STORAGE_DRIVER", "local");
    vi.stubEnv("LOCAL_STORAGE_PATH", join(root, "objects"));
    vi.stubEnv("OSS_UPLOAD_PREFIX", "koma");
    const storage = await import("./storage.js");
    await storage.initializeStorage();

    const id = "11111111-1111-4111-8111-111111111111";
    const prefix = storage.jobStoragePrefix(id);
    const source = join(root, "source.mp4");
    await writeFile(source, "video-bytes");
    await storage.putStoredFile(`${prefix}/video/source.mp4`, source, "video/mp4");
    await storage.putStoredText(`${prefix}/artifacts/0-report.md`, "# report", "text/markdown");

    expect(await storage.readStoredText(`${prefix}/artifacts/0-report.md`)).toBe("# report");
    const object = await storage.storedObjectInfo(`${prefix}/video/source.mp4`);
    expect(object).toMatchObject({ size: 11 });

    await storage.deleteStoredPrefix(prefix);
    await expect(storage.storedObjectInfo(`${prefix}/video/source.mp4`)).rejects.toThrow();
  });
});
