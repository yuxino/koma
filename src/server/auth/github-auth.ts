import { createHash, randomBytes } from "node:crypto";
import {
  consumeOAuthAttempt, deleteAccountSession, readAccountSession, saveAccount, saveAccountSession,
  saveOAuthAttempt, type AccountUser
} from "../persistence/database.js";

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_SECONDS = 10 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_COOKIE = "koma_session";
const LOGIN_COOKIE = "koma_oauth";

export function githubAuthEnabled(): boolean {
  return Boolean(githubConfiguration());
}

function githubConfiguration() {
  const clientId = String(process.env.GITHUB_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GITHUB_CLIENT_SECRET || "").trim();
  const callbackUrl = String(process.env.GITHUB_CALLBACK_URL || "").trim();
  if (!clientId || !clientSecret || !callbackUrl) return null;
  try {
    const url = new URL(callbackUrl);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/api/auth/github/callback") return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
  } catch { return null; }
  return { clientId, clientSecret, callbackUrl };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 1800 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://koma.invalid");
    if (parsed.origin !== "https://koma.invalid" || parsed.pathname.startsWith("/api/")) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return "/"; }
}

export async function beginGithubLogin(returnTo: unknown, secure: boolean, now = Date.now()) {
  const settings = githubConfiguration();
  if (!settings) return null;
  const state = randomToken();
  const browserToken = randomToken();
  const verifier = randomToken();
  await saveOAuthAttempt({ stateHash: hashToken(state), browserHash: hashToken(browserToken), verifier, returnTo: safeReturnTo(returnTo), expiresAt: now + LOGIN_SECONDS * 1000 }, now);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.callbackUrl, state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), cookie: cookie(LOGIN_COOKIE, browserToken, LOGIN_SECONDS, secure) };
}

export type LoginResult = { ok: true; user: AccountUser; returnTo: string; cookie: string } | { ok: false; reason: "cancelled" | "expired" | "unavailable" };

export async function completeGithubLogin(query: { state?: unknown; code?: unknown; error?: unknown }, cookieHeader: string | undefined, secure: boolean, fetcher: typeof fetch = fetch, now = Date.now()): Promise<LoginResult> {
  const settings = githubConfiguration();
  if (!settings) return { ok: false, reason: "unavailable" };
  const browserToken = readTokenCookie(cookieHeader, LOGIN_COOKIE);
  if (!browserToken || typeof query.state !== "string" || !TOKEN_PATTERN.test(query.state)) return { ok: false, reason: "expired" };
  const attempt = await consumeOAuthAttempt(hashToken(query.state), hashToken(browserToken), now);
  if (!attempt) return { ok: false, reason: "expired" };
  if (query.error) return { ok: false, reason: "cancelled" };
  if (typeof query.code !== "string" || !query.code || query.code.length > 1000) return { ok: false, reason: "expired" };
  try {
    const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, code: query.code, redirect_uri: settings.callbackUrl, code_verifier: attempt.verifier }),
      signal: AbortSignal.timeout(15_000), redirect: "error"
    });
    if (!tokenResponse.ok) return { ok: false, reason: "unavailable" };
    const token = await tokenResponse.json() as { access_token?: unknown; error?: unknown };
    if (token.error || typeof token.access_token !== "string" || !token.access_token) return { ok: false, reason: "unavailable" };
    const userResponse = await fetcher("https://api.github.com/user", {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token.access_token}`, "x-github-api-version": "2026-03-10", "user-agent": "Koma" },
      signal: AbortSignal.timeout(15_000), redirect: "error"
    });
    if (!userResponse.ok) return { ok: false, reason: "unavailable" };
    const profile = await userResponse.json() as Record<string, unknown>;
    if (!Number.isSafeInteger(profile.id) || Number(profile.id) <= 0 || typeof profile.login !== "string" || !/^[a-z\d-]{1,39}$/i.test(profile.login)) return { ok: false, reason: "unavailable" };
    const user: AccountUser = { id: String(profile.id), login: profile.login, name: typeof profile.name === "string" ? profile.name.slice(0, 200) : null, avatarUrl: `https://avatars.githubusercontent.com/u/${profile.id}?v=4` };
    await saveAccount(user, now);
    // GitHub tokens are only used for identity lookup, never stored or sent to the browser.
    await revokeAccountSession(cookieHeader);
    const sessionToken = randomToken();
    await saveAccountSession(hashToken(sessionToken), user.id, now + SESSION_SECONDS * 1000);
    return { ok: true, user, returnTo: safeReturnTo(attempt.returnTo), cookie: cookie(SESSION_COOKIE, sessionToken, SESSION_SECONDS, secure) };
  } catch {
    // Provider payloads/errors may contain authorization codes or tokens. Keep them out of logs.
    return { ok: false, reason: "unavailable" };
  }
}

export async function currentAccount(cookieHeader: string | undefined, now = Date.now()): Promise<AccountUser | null> {
  const token = readTokenCookie(cookieHeader, SESSION_COOKIE);
  return token ? readAccountSession(hashToken(token), now) : null;
}

export async function revokeAccountSession(cookieHeader: string | undefined): Promise<void> {
  const token = readTokenCookie(cookieHeader, SESSION_COOKIE);
  if (token) await deleteAccountSession(hashToken(token));
}

export function clearAccountCookie(secure: boolean): string { return cookie(SESSION_COOKIE, "", 0, secure); }
export function clearGithubLoginCookie(secure: boolean): string { return cookie(LOGIN_COOKIE, "", 0, secure); }

function randomToken(): string { return randomBytes(32).toString("base64url"); }
function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function readTokenCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const token = part.slice(index + 1).trim();
    return TOKEN_PATTERN.test(token) ? token : null;
  }
  return null;
}
