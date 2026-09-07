export interface StarSnapshot { readonly count: number; readonly checkedAt: string }

export const GITHUB_STAR_SNAPSHOT: StarSnapshot = Object.freeze({
  count: 2,
  checkedAt: "2026-09-07T15:46:30.053665+00:00"
});

const CACHE_KEY = "koma.github-stars.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5_000;
const REPOSITORY = "yuxino/koma";
type StarStorage = Pick<Storage, "getItem" | "setItem">;
let memoryCache: StarSnapshot | undefined;

function validSnapshot(value: unknown, now: number): StarSnapshot | undefined {
  if (!value || typeof value !== "object") return;
  const { count, checkedAt } = value as Partial<StarSnapshot>;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || typeof checkedAt !== "string" || checkedAt.length > 40) return;
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp) || timestamp > now || timestamp < Date.parse(GITHUB_STAR_SNAPSHOT.checkedAt)) return;
  return Object.freeze({ count, checkedAt });
}

export function readGithubStarSnapshot(storage?: StarStorage, now = Date.now()): StarSnapshot {
  let snapshot = validSnapshot(memoryCache, now) ?? GITHUB_STAR_SNAPSHOT;
  try {
    const cached = validSnapshot(JSON.parse(storage?.getItem(CACHE_KEY) ?? "null"), now);
    if (cached && Date.parse(cached.checkedAt) >= Date.parse(snapshot.checkedAt)) snapshot = cached;
  } catch { /* Storage can be unavailable or contain an interrupted/old write. */ }
  if (snapshot !== GITHUB_STAR_SNAPSHOT) memoryCache = snapshot;
  return snapshot;
}

interface RefreshOptions {
  storage?: StarStorage;
  fetcher?: typeof fetch;
  now?: number;
  signal?: AbortSignal;
}

export async function refreshGithubStars({ storage, fetcher = globalThis.fetch, now, signal }: RefreshOptions = {}): Promise<StarSnapshot> {
  const currentTime = () => now ?? Date.now();
  const previous = readGithubStarSnapshot(storage, currentTime());
  if (signal?.aborted || (previous !== GITHUB_STAR_SNAPSHOT && currentTime() - Date.parse(previous.checkedAt) < CACHE_TTL_MS)) return previous;

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
    if (signal?.aborted) return readGithubStarSnapshot(storage, currentTime());
    memoryCache = snapshot;
    try { storage?.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* Keep the verified count in memory if persistence is blocked. */ }
    return snapshot;
  } catch {
    return readGithubStarSnapshot(storage, currentTime());
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (cancel) signal?.removeEventListener("abort", cancel);
  }
}
