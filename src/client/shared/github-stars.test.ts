import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "koma.github-stars.v1";
const NOW = Date.parse("2026-09-08T18:00:00.000Z");
const HOUR = 60 * 60 * 1000;
let stars: typeof import("./github-stars");
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ now: NOW });
  stars = await import("./github-stars");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function storage(value?: unknown) {
  const values = new Map<string, string>();
  if (value !== undefined) values.set(KEY, JSON.stringify(value));
  return { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, content: string) => { values.set(key, content); }) };
}
function snapshot(count = 8, age = HOUR) { return { count, checkedAt: new Date(NOW - age).toISOString() }; }
function fetcher(data: unknown = { full_name: "yuxino/koma", stargazers_count: 9 }) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
}

describe("GitHub star snapshots", () => {
  it("imports without window and starts from the verified build snapshot", async () => {
    vi.stubGlobal("window", undefined);
    expect(stars.readGithubStarSnapshot()).toEqual({ count: 2, checkedAt: "2026-09-07T15:46:30.053665+00:00" });
  });

  it("reads the newest valid cache, including a real zero", () => {
    expect(stars.readGithubStarSnapshot(storage(snapshot(0)))).toEqual(snapshot(0));
  });

  it.each([
    { count: 100, checkedAt: "not-a-date" },
    { count: 100, checkedAt: "2099-01-01T00:00:00Z" },
    { count: 100, checkedAt: "2026-09-07T15:00:00Z" },
    { count: -1, checkedAt: new Date(NOW).toISOString() },
    { count: 1.5, checkedAt: new Date(NOW).toISOString() },
    { count: "123", checkedAt: new Date(NOW).toISOString() }
  ])("ignores invalid, future, or older-than-build caches: %j", cached => {
    expect(stars.readGithubStarSnapshot(storage(cached))).toEqual(stars.GITHUB_STAR_SNAPSHOT);
  });

  it("does not request while the cache is fresh", async () => {
    const cached = snapshot(8, 6 * HOUR - 1); const request = fetcher();
    expect(await stars.refreshGithubStars({ storage: storage(cached), fetcher: request, now: NOW })).toEqual(cached);
    expect(request).not.toHaveBeenCalled();
  });

  it("refreshes at six hours and persists the real zero without credentials", async () => {
    const cache = storage(snapshot(8, 6 * HOUR)); const request = fetcher({ full_name: "yuxino/koma", stargazers_count: 0 });
    expect(await stars.refreshGithubStars({ storage: cache, fetcher: request })).toEqual(snapshot(0, 0));
    expect(request).toHaveBeenCalledExactlyOnceWith("https://api.github.com/repos/yuxino/koma", {
      headers: { Accept: "application/vnd.github+json" }, credentials: "omit", signal: expect.any(AbortSignal)
    });
    expect(cache.setItem).toHaveBeenCalledWith(KEY, JSON.stringify(snapshot(0, 0)));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes without storage and accepts an absent optional repository name", async () => {
    const request = fetcher({ stargazers_count: 12 });
    expect(await stars.refreshGithubStars({ fetcher: request })).toEqual(snapshot(12, 0));
    expect(stars.readGithubStarSnapshot()).toEqual(snapshot(12, 0));
    await stars.refreshGithubStars({ fetcher: request });
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    { full_name: "somebody/else", stargazers_count: 20 },
    { full_name: null, stargazers_count: 20 },
    { stargazers_count: -1 },
    { stargazers_count: 2.2 },
    { stargazers_count: Number.MAX_SAFE_INTEGER + 1 },
    { stargazers_count: "20" },
    {}, null
  ])("preserves the last genuine count after an invalid response: %j", async data => {
    const cached = snapshot(7, 7 * HOUR); const cache = storage(cached);
    expect(await stars.refreshGithubStars({ storage: cache, fetcher: fetcher(data) })).toEqual(cached);
    expect(cache.setItem).not.toHaveBeenCalled();
  });

  it.each(["403", "network", "malformed-json"])("keeps a stale real number on %s and never polls", async failure => {
    const cached = snapshot(7, 7 * HOUR); const request = fetcher();
    if (failure === "403") request.mockResolvedValue(new Response(null, { status: 403 }));
    if (failure === "network") request.mockRejectedValue(new Error("Offline"));
    if (failure === "malformed-json") request.mockResolvedValue(new Response("not-json"));
    expect(await stars.refreshGithubStars({ storage: storage(cached), fetcher: request })).toEqual(cached);
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(request).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds even a fetcher that ignores abort to five seconds", async () => {
    const cached = snapshot(7, 7 * HOUR); const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = stars.refreshGithubStars({ storage: storage(cached), fetcher: request });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(cached);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also times out a stalled response body and ignores its late success", async () => {
    const cached = snapshot(7, 7 * HOUR); const cache = storage(cached);
    let finish!: (value: unknown) => void;
    const request = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) } as Response);
    const pending = stars.refreshGithubStars({ storage: cache, fetcher: request });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toEqual(cached);
    finish({ stargazers_count: 999 });
    await Promise.resolve(); await Promise.resolve();
    expect(stars.readGithubStarSnapshot(cache)).toEqual(cached);
    expect(cache.setItem).not.toHaveBeenCalled();
  });

  it("handles external cancellation immediately and cleans up its timer", async () => {
    const cached = snapshot(7, 7 * HOUR); const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = stars.refreshGithubStars({ storage: storage(cached), fetcher: request, signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual(cached);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    request.mockClear();
    await stars.refreshGithubStars({ fetcher: request, signal: controller.signal });
    expect(request).not.toHaveBeenCalled();
  });

  it("tolerates corrupt or blocked storage and retains a new count after write failure", async () => {
    const cache = storage(); cache.getItem.mockImplementation(() => { throw new Error("Blocked"); });
    cache.setItem.mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(stars.readGithubStarSnapshot(cache)).toEqual(stars.GITHUB_STAR_SNAPSHOT);
    expect(await stars.refreshGithubStars({ storage: cache, fetcher: fetcher() })).toEqual(snapshot(9, 0));
    expect(stars.readGithubStarSnapshot(cache)).toEqual(snapshot(9, 0));
    cache.getItem.mockReturnValue("not-json");
    expect(stars.readGithubStarSnapshot(cache)).toEqual(snapshot(9, 0));
  });
});
