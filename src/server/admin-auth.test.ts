import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("admin authentication", () => {
  it("stays disabled without an explicit server password", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const auth = await import("./admin-auth.js");
    expect(auth.adminAuthEnabled()).toBe(false);
    expect(auth.createAdminSession("anything", "127.0.0.1")).toBeNull();
  });

  it("keeps visitor analysis public when only the admin console password is configured", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.stubEnv("ANALYSIS_REQUIRE_ADMIN", "");
    const auth = await import("./admin-auth.js");
    expect(auth.adminAuthEnabled()).toBe(true);
    expect(auth.analysisAuthRequired()).toBe(false);
  });

  it("protects analysis only when explicitly enabled alongside the admin console", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.stubEnv("ANALYSIS_REQUIRE_ADMIN", "true");
    const auth = await import("./admin-auth.js");
    expect(auth.analysisAuthRequired()).toBe(true);
  });

  it("creates an HttpOnly same-site session for a valid password", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    const auth = await import("./admin-auth.js");
    const token = auth.createAdminSession("correct horse battery staple", "127.0.0.1", 1000);
    expect(token).toBeTruthy();
    const cookie = auth.adminSessionCookie(token!, true);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(auth.isAdminSession(cookie, 2000)).toBe(true);
    auth.revokeAdminSession(cookie);
    expect(auth.isAdminSession(cookie, 2000)).toBe(false);
  });

  it("rate limits repeated invalid passwords by source IP", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "secret");
    const auth = await import("./admin-auth.js");
    for (let attempt = 0; attempt < 5; attempt += 1) expect(auth.createAdminSession("wrong", "203.0.113.8", attempt)).toBeNull();
    expect(() => auth.createAdminSession("secret", "203.0.113.8", 6)).toThrow("登录尝试过多");
  });
});
