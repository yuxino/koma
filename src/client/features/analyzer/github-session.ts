import { useCallback, useEffect, useRef, useState } from "react";

export interface GithubSession {
  enabled: boolean;
  authenticated: boolean;
  user?: { id: string; login: string; name: string | null; avatarUrl: string };
  legacyJobCount?: number;
}

export function useGithubSession() {
  const [session, setSession] = useState<GithubSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [expired, setExpired] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestRevision = useRef(0);
  const authenticatedRef = useRef(false);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  const expire = useCallback(() => {
    requestRevision.current += 1;
    authenticatedRef.current = false;
    setSession((current) => ({ enabled: current?.enabled ?? true, authenticated: false }));
    setExpired(true);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function readSession() {
      if (fetching) return;
      fetching = true;
      const expectedRevision = requestRevision.current;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Session unavailable");
        const next = await response.json() as GithubSession;
        if (!controller.signal.aborted && expectedRevision === requestRevision.current) {
          if (authenticatedRef.current && !next.authenticated) setExpired(true);
          authenticatedRef.current = next.authenticated;
          setSession(next);
          setUnavailable(false);
          if (next.authenticated) setExpired(false);
        }
      } catch {
        if (!controller.signal.aborted && expectedRevision === requestRevision.current) setUnavailable(true);
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void readSession();
    const focus = () => { if (document.visibilityState === "visible") void readSession(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { controller.abort(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [revision]);

  const logout = useCallback(async () => {
    const response = await fetch("/api/auth/session", { method: "DELETE", headers: { "X-Koma-Client": "1" } });
    if (!response.ok && response.status !== 401) throw new Error("logout_failed");
    requestRevision.current += 1;
    authenticatedRef.current = false;
    setSession((current) => ({ enabled: current?.enabled ?? true, authenticated: false }));
    setExpired(false);
  }, []);

  return { session, loading, unavailable, expired, expire, refresh, logout };
}
