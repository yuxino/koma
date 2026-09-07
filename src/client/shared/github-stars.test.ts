import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GITHUB_STAR_SNAPSHOT, refreshGithubStars } from "./github-stars";

const NOW = Date.parse("2026-09-08T18:00:00.000Z");
beforeEach(() => { vi.useFakeTimers({ now: NOW }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function snapshot(count: number) { return { count, checkedAt: new Date(NOW).toISOString() }; }
function fetcher(data: unknown = { full_name: "yuxino/koma", stargazers_count: 9 }) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }));
}

describe("uncached GitHub star requests", () => {
  it("imports without window and leaves storage untouched during requests", async () => {
    const blocked = new Proxy({}, { get: () => { throw new Error("Storage must not be accessed"); } });
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("sessionStorage", blocked);
    const request = fetcher(); vi.stubGlobal("fetch", request);
    vi.resetModules();
    const stars = await import("./github-stars");
    expect(stars.GITHUB_STAR_SNAPSHOT).toEqual({ count: 2, checkedAt: "2026-09-07T15:46:30.053665+00:00" });
    expect(request).not.toHaveBeenCalled();
    expect(await stars.refreshGithubStars()).toEqual(snapshot(9));
  });

  it("requests fresh anonymous data on every call and accepts a real zero", async () => {
    const request = fetcher({ full_name: "yuxino/koma", stargazers_count: 0 });
    request.mockResolvedValueOnce(new Response(JSON.stringify({ full_name: "yuxino/koma", stargazers_count: 7 })));
    expect(await refreshGithubStars({ fetcher: request, now: NOW })).toEqual(snapshot(7));
    expect(await refreshGithubStars({ fetcher: request, now: NOW })).toEqual(snapshot(0));
    expect(request).toHaveBeenCalledTimes(2);
    for (const call of request.mock.calls) expect(call).toEqual(["https://api.github.com/repos/yuxino/koma", {
      headers: { Accept: "application/vnd.github+json" }, credentials: "omit", cache: "no-store", signal: expect.any(AbortSignal)
    }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts an absent optional repository name", async () => {
    expect(await refreshGithubStars({ fetcher: fetcher({ stargazers_count: 12 }) })).toEqual(snapshot(12));
  });

  it.each([
    { full_name: "somebody/else", stargazers_count: 20 },
    { full_name: null, stargazers_count: 20 },
    { stargazers_count: -1 },
    { stargazers_count: 2.2 },
    { stargazers_count: Number.MAX_SAFE_INTEGER + 1 },
    { stargazers_count: "20" },
    {}, null
  ])("falls back to the verified snapshot after an invalid response: %j", async data => {
    expect(await refreshGithubStars({ fetcher: fetcher(data) })).toBe(GITHUB_STAR_SNAPSHOT);
  });

  it.each(["403", "network", "malformed-json"])("uses the build fallback on %s even after success, and never polls", async failure => {
    const request = fetcher();
    expect(await refreshGithubStars({ fetcher: request })).toEqual(snapshot(9));
    if (failure === "403") request.mockResolvedValue(new Response(null, { status: 403 }));
    if (failure === "network") request.mockRejectedValue(new Error("Offline"));
    if (failure === "malformed-json") request.mockResolvedValue(new Response("not-json"));
    expect(await refreshGithubStars({ fetcher: request })).toBe(GITHUB_STAR_SNAPSHOT);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds even a fetcher that ignores abort to five seconds", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = refreshGithubStars({ fetcher: request });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(GITHUB_STAR_SNAPSHOT);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("also times out a stalled response body and ignores its late success", async () => {
    let finish!: (value: unknown) => void;
    const request = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, json: () => new Promise(resolve => { finish = resolve; }) } as Response);
    const pending = refreshGithubStars({ fetcher: request });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await pending).toBe(GITHUB_STAR_SNAPSHOT);
    finish({ stargazers_count: 999 });
    await Promise.resolve(); await Promise.resolve();
    request.mockRejectedValue(new Error("Offline"));
    expect(await refreshGithubStars({ fetcher: request })).toBe(GITHUB_STAR_SNAPSHOT);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("handles external cancellation immediately and cleans up its timer", async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = refreshGithubStars({ fetcher: request, signal: controller.signal });
    controller.abort();
    expect(await pending).toBe(GITHUB_STAR_SNAPSHOT);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    request.mockClear();
    expect(await refreshGithubStars({ fetcher: request, signal: controller.signal })).toBe(GITHUB_STAR_SNAPSHOT);
    expect(request).not.toHaveBeenCalled();
  });
});
