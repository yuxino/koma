import { describe, expect, it } from "vitest";
import { readViewerOwnerId, resolveViewerIdentity, viewerSessionCookie } from "./viewer-session.js";

describe("accountless viewer identity", () => {
  it("creates a stable owner digest without exposing it as the browser token", () => {
    const first = resolveViewerIdentity(undefined);
    expect(first.created).toBe(true);
    expect(first.token).toHaveLength(43);
    expect(first.ownerId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.ownerId).not.toBe(first.token);

    const second = resolveViewerIdentity(`other=1; koma_viewer=${first.token}`);
    expect(second).toEqual({ ...first, created: false });
    expect(readViewerOwnerId(`koma_viewer=${first.token}`)).toBe(first.ownerId);
  });

  it("replaces malformed cookies and emits a long-lived HttpOnly cookie", () => {
    const identity = resolveViewerIdentity("koma_viewer=guessable");
    expect(identity.created).toBe(true);
    expect(readViewerOwnerId("koma_viewer=guessable")).toBeNull();
    expect(viewerSessionCookie(identity.token, true)).toContain("HttpOnly");
    expect(viewerSessionCookie(identity.token, true)).toContain("SameSite=Lax");
    expect(viewerSessionCookie(identity.token, true)).toContain("Secure");
  });
});
