import { describe, expect, it } from "vitest";
import { createDailyLimiter } from "./rate-limit.js";

describe("daily demo limiter", () => {
  it("blocks an address after its daily allowance", () => {
    const limiter = createDailyLimiter(2);
    const now = Date.UTC(2026, 7, 20, 12);
    expect(limiter.consume("203.0.113.1", now)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("203.0.113.1", now)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("203.0.113.1", now)).toMatchObject({ allowed: false, remaining: 0 });
    expect(limiter.consume("203.0.113.2", now)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("resets at the next UTC day", () => {
    const limiter = createDailyLimiter(1);
    expect(limiter.consume("ip", Date.UTC(2026, 7, 20, 23, 59)).allowed).toBe(true);
    expect(limiter.consume("ip", Date.UTC(2026, 7, 21, 0, 1)).allowed).toBe(true);
  });

  it("does nothing when disabled", () => {
    const limiter = createDailyLimiter(0);
    expect(limiter.consume("ip").allowed).toBe(true);
    expect(limiter.consume("ip").allowed).toBe(true);
  });
});
