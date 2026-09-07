import { mkdtemp, readFile, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { retainedInputPath, retainRetrySource } from "./retry-source.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), "koma-retry-source-")); cleanup.push(dir); const inputPath = join(dir, "input.mp4"); await writeFile(inputPath, "complete video"); return { dir, inputPath, status: "failed" }; }

describe("private complete sources for manual retry", () => {
  it("restores a complete retained source from disk after the in-memory job is gone", async () => {
    const job = await fixture();
    await retainRetrySource(job);
    expect(await retainedInputPath({ dir: job.dir, status: "failed" })).toBe(job.inputPath);
    expect(await readFile(job.inputPath, "utf8")).toBe("complete video");
    // Windows chmod does not expose POSIX owner/group permission bits.
    if (process.platform !== "win32") {
      expect((await stat(job.inputPath)).mode & 0o777).toBe(0o600);
      expect((await stat(job.dir)).mode & 0o777).toBe(0o700);
      expect((await stat(join(job.dir, "retry-source.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("does not advertise unmarked, incomplete, deleted, or active inputs for retry", async () => {
    const job = await fixture();
    expect(await retainedInputPath(job)).toBeUndefined();
    await retainRetrySource(job);
    expect(await retainedInputPath({ ...job, status: "processing" })).toBeUndefined();
    await truncate(job.inputPath, 2);
    expect(await retainedInputPath(job)).toBeUndefined();
    await rm(job.inputPath);
    expect(await retainedInputPath(job)).toBeUndefined();
  });

  it("rejects manifest traversal and symlinks instead of opening unrelated files", async () => {
    const job = await fixture();
    await writeFile(join(job.dir, "retry-source.json"), JSON.stringify({ filename: "../input.mp4", size: 14 }));
    expect(await retainedInputPath(job)).toBeUndefined();
    await rm(job.inputPath);
    await symlink(join(job.dir, "retry-source.json"), job.inputPath);
    await writeFile(join(job.dir, "retry-source.json"), JSON.stringify({ filename: "input.mp4", size: 14 }));
    expect(await retainedInputPath(job)).toBeUndefined();
    await retainRetrySource(job);
    expect(await retainedInputPath(job)).toBeUndefined();
  });
});
