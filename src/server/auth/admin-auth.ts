import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const sessionTtlMs = 12 * 60 * 60 * 1000;
const sessions = new Map<string, number>();
const attempts = new Map<string, number[]>();

export function adminAuthEnabled(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function analysisAuthRequired(): boolean {
  if (!adminAuthEnabled()) return false;
  return ["1", "true", "on", "yes"].includes(String(process.env.ANALYSIS_REQUIRE_ADMIN || "").trim().toLowerCase());
}

export function createAdminSession(password: unknown, ip: string, now = Date.now()): string | null {
  if (!adminAuthEnabled()) return null;
  if (!loginAllowed(ip, now)) throw new Error("登录尝试过多，请 15 分钟后再试。");
  if (typeof password !== "string" || !passwordMatches(password, process.env.ADMIN_PASSWORD || "")) {
    recordFailedAttempt(ip, now);
    return null;
  }
  attempts.delete(ip);
  const token = randomBytes(32).toString("base64url");
  sessions.set(token, now + sessionTtlMs);
  return token;
}

export function isAdminSession(cookieHeader: string | undefined, now = Date.now()): boolean {
  const token = readCookie(cookieHeader, "koma_admin");
  if (!token) return false;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= now) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function revokeAdminSession(cookieHeader: string | undefined): void {
  const token = readCookie(cookieHeader, "koma_admin");
  if (token) sessions.delete(token);
}

export function adminSessionCookie(token: string, secure: boolean): string {
  return `koma_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionTtlMs / 1000)}${secure ? "; Secure" : ""}`;
}

export function clearAdminSessionCookie(secure: boolean): string {
  return `koma_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

function passwordMatches(candidate: string, expected: string): boolean {
  const left = createHash("sha256").update(candidate).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

function loginAllowed(ip: string, now: number): boolean {
  const recent = (attempts.get(ip) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
  attempts.set(ip, recent);
  return recent.length < 5;
}

function recordFailedAttempt(ip: string, now: number): void {
  attempts.set(ip, [...(attempts.get(ip) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000), now]);
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim() || null;
  }
  return null;
}
