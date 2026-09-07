export interface StarSnapshot { readonly count: number; readonly checkedAt: string }

export const GITHUB_STAR_SNAPSHOT: StarSnapshot = Object.freeze({
  count: 2,
  checkedAt: "2026-09-07T15:46:30.053665+00:00"
});

const REQUEST_TIMEOUT_MS = 5_000;
const REPOSITORY = "yuxino/koma";

interface RefreshOptions {
  fetcher?: typeof fetch;
  now?: number;
  signal?: AbortSignal;
}

export async function refreshGithubStars({ fetcher = globalThis.fetch, now, signal }: RefreshOptions = {}): Promise<StarSnapshot> {
  const currentTime = () => now ?? Date.now();
  if (signal?.aborted) return GITHUB_STAR_SNAPSHOT;

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => { controller.abort(); reject(new DOMException("Star refresh cancelled", "AbortError")); };
    signal?.addEventListener("abort", cancel, { once: true });
    timeout = setTimeout(cancel, REQUEST_TIMEOUT_MS);
  });
  try {
    const request = async (): Promise<StarSnapshot> => {
      const response = await fetcher(`https://api.github.com/repos/${REPOSITORY}`, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("GitHub repository request failed");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("Invalid GitHub repository response");
      const { full_name, stargazers_count } = data as { full_name?: unknown; stargazers_count?: unknown };
      if ((full_name !== undefined && full_name !== REPOSITORY)
        || typeof stargazers_count !== "number" || !Number.isSafeInteger(stargazers_count) || stargazers_count < 0) {
        throw new Error("Invalid GitHub star count");
      }
      return Object.freeze({ count: stargazers_count, checkedAt: new Date(currentTime()).toISOString() });
    };
    const snapshot = await Promise.race([request(), interrupted]);
    return signal?.aborted ? GITHUB_STAR_SNAPSHOT : snapshot;
  } catch {
    return GITHUB_STAR_SNAPSHOT;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
