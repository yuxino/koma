import { createHash, randomBytes } from "node:crypto";

const COOKIE_NAME = "koma_viewer";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export interface ViewerIdentity {
  ownerId: string;
  token: string;
  created: boolean;
}

/**
 * Give an accountless visitor a stable, unguessable browser identity.
 * Only its SHA-256 digest is stored with jobs; the bearer token stays in an
 * HttpOnly cookie and is never returned in JSON or written to logs.
 */
export function resolveViewerIdentity(cookieHeader: string | undefined): ViewerIdentity {
  const existing = readCookie(cookieHeader, COOKIE_NAME);
  const token = existing && TOKEN_PATTERN.test(existing) ? existing : randomBytes(32).toString("base64url");
  return { ownerId: hashViewerToken(token), token, created: token !== existing };
}

export function readViewerOwnerId(cookieHeader: string | undefined): string | null {
  const token = readCookie(cookieHeader, COOKIE_NAME);
  return token && TOKEN_PATTERN.test(token) ? hashViewerToken(token) : null;
}

export function viewerSessionCookie(token: string, secure: boolean): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("访客身份令牌无效。");
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`;
}

function hashViewerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim() || null;
  }
  return null;
}
