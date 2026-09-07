import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDatabase, readAccountSession } from "../persistence/database.js";
import { beginGithubLogin, completeGithubLogin, currentAccount, githubAuthEnabled, hashToken, revokeAccountSession, safeReturnTo } from "./github-auth.js";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "koma-github-auth-"));
  vi.stubEnv("DB_DRIVER", "sqlite");
  vi.stubEnv("KOMA_DATABASE_PATH", join(root, "koma.sqlite"));
  vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.test");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "test-only-secret");
  vi.stubEnv("GITHUB_CALLBACK_URL", "https://koma.example/api/auth/github/callback");
});
afterAll(async () => { await closeDatabase(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function start(returnTo: unknown = "/?job=example") {
  const login = await beginGithubLogin(returnTo, true);
  expect(login).not.toBeNull();
  const url = new URL(login!.url);
  return { login: login!, url, state: url.searchParams.get("state")!, cookie: login!.cookie.split(";", 1)[0] };
}
function provider() {
  return vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "ghu_test", refresh_token: "never-persist-this" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1234, login: "account-one", name: "One" }), { status: 200 }));
}

describe("GitHub App login", () => {
  it("uses state, independently bound HttpOnly cookie and S256 PKCE without permission scopes", async () => {
    const { login, url, state, cookie } = await start();
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(login.cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=600; Secure");
    expect(cookie).not.toContain(state);
    const fetcher = provider();
    const result = await completeGithubLogin({ state, code: "test-code" }, cookie, true, fetcher);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful login");
    const form = fetcher.mock.calls[0][1]!.body as URLSearchParams;
    expect(form.get("client_secret")).toBe("test-only-secret");
    expect(form.get("code")).toBe("test-code");
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    expect(fetcher.mock.calls[1][0]).toBe("https://api.github.com/user");
    expect(result.returnTo).toBe("/?job=example");
    expect(result.cookie).toContain("HttpOnly; SameSite=Lax; Max-Age=604800; Secure");
    expect(await currentAccount(result.cookie)).toEqual(result.user);
    expect(await currentAccount(result.cookie, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    await revokeAccountSession(result.cookie);
    expect(await currentAccount(result.cookie)).toBeNull();
    expect(await readAccountSession(result.cookie.split("=", 2)[1].split(";", 1)[0])).toBeNull();
  });

  it("rejects missing/mismatched state and browser binding, and replays before provider access", async () => {
    const first = await start();
    const second = await start();
    const fetcher = provider();
    expect(await completeGithubLogin({ state: first.state, code: "code" }, undefined, true, fetcher)).toEqual({ ok: false, reason: "expired" });
    expect(await completeGithubLogin({ state: first.state, code: "code" }, second.cookie, true, fetcher)).toEqual({ ok: false, reason: "expired" });
    expect(fetcher).not.toHaveBeenCalled();
    const results = await Promise.all([1, 2].map(() => completeGithubLogin({ state: first.state, code: "code" }, first.cookie, true, fetcher)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await completeGithubLogin({ state: first.state, code: "code" }, first.cookie, true, fetcher)).toEqual({ ok: false, reason: "expired" });
  });

  it("expires login attempts and consumes denied authorizations", async () => {
    const expired = await start();
    const fetcher = provider();
    expect(await completeGithubLogin({ state: expired.state, code: "code" }, expired.cookie, true, fetcher, Date.now() + 11 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
    const denied = await start();
    expect(await completeGithubLogin({ state: denied.state, error: "access_denied" }, denied.cookie, true, fetcher)).toEqual({ ok: false, reason: "cancelled" });
    expect(await completeGithubLogin({ state: denied.state, code: "code" }, denied.cookie, true, fetcher)).toEqual({ ok: false, reason: "expired" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose provider errors or follow provider redirects", async () => {
    const flow = await start();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("secret provider payload"));
    expect(await completeGithubLogin({ state: flow.state, code: "code" }, flow.cookie, true, fetcher)).toEqual({ ok: false, reason: "unavailable" });
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("error");
  });

  it("persists hashed sessions across a database restart", async () => {
    const flow = await start();
    const result = await completeGithubLogin({ state: flow.state, code: "code" }, flow.cookie, false, provider());
    if (!result.ok) throw new Error("Expected successful login");
    await closeDatabase();
    expect((await currentAccount(result.cookie))?.id).toBe("1234");
    expect(hashToken("test")).toHaveLength(64);
  });

  it.each(["https://evil.test/", "//evil.test/", "/\\evil.test", "/\nevil.test", "/api/auth/github", null, "/".repeat(2000)])("rejects unsafe return targets %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });

  it("requires the exact callback path and HTTPS outside loopback", () => {
    expect(githubAuthEnabled()).toBe(true);
    vi.stubEnv("GITHUB_CALLBACK_URL", "http://koma.example/api/auth/github/callback");
    expect(githubAuthEnabled()).toBe(false);
    vi.stubEnv("GITHUB_CALLBACK_URL", "http://127.0.0.1:3010/api/auth/github/callback");
    expect(githubAuthEnabled()).toBe(true);
    vi.stubEnv("GITHUB_CALLBACK_URL", "https://koma.example/api/auth/github/callback");
  });
});
