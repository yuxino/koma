import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const processMocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn(() => ({ status: 1, stdout: "" })) }));
vi.mock("node:child_process", () => processMocks);
import { resolveVideoUrl, resolveWithYtDlp } from "./resolver.js";

afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true)
  });
  processMocks.spawn.mockReturnValue(child);
  return child;
}

describe("yt-dlp cancellation", () => {
  it("does not discover or spawn a process for a pre-canceled URL", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(resolveVideoUrl("https://example.com/watch", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(processMocks.spawnSync).not.toHaveBeenCalled();
    expect(processMocks.spawn).not.toHaveBeenCalled();
  });

  it("kills a running resolver, waits for close, and rejects a late success", async () => {
    vi.stubEnv("YTDLP_PATH", "/fixture/yt-dlp");
    const child = fakeProcess();
    const controller = new AbortController();
    const resolving = resolveVideoUrl("https://example.com/watch", { signal: controller.signal });
    const rejected = expect(resolving).rejects.toMatchObject({ name: "AbortError" });
    let settled = false;
    void resolving.then(() => { settled = true; }, () => { settled = true; });
    try {
      controller.abort();
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally {
      child.stdout.write("https://example.com/late.mp4\n");
      child.emit("close", 0);
      await rejected;
    }
  });

  it("stops fallback candidates when cancellation arrives between attempts", async () => {
    const controller = new AbortController();
    const runImpl = vi.fn(async () => { controller.abort(); return { stdout: "", stderr: "" }; });
    await expect(resolveWithYtDlp("https://example.com/watch", {
      commands: [{ bin: "first", args: [] }, { bin: "second", args: [] }], runImpl, signal: controller.signal
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(runImpl).toHaveBeenCalledOnce();
  });

  it("removes the cancellation listener after a successful resolver closes", async () => {
    const child = fakeProcess();
    const controller = new AbortController();
    const resolving = resolveWithYtDlp("https://example.com/watch", {
      commands: [{ bin: "fixture", args: [] }], signal: controller.signal
    });
    child.stdout.write("https://example.com/video.mp4\n");
    child.emit("close", 0);
    expect(await resolving).toBe("https://example.com/video.mp4");
    controller.abort();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
