import { describe, expect, it } from "vitest";
import { formatTime } from "./format.js";

describe("formatTime", () => {
  it("formats under one minute with a leading zero on seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(1000)).toBe("0:01");
    expect(formatTime(59_500)).toBe("1:00");
  });

  it("formats minutes without an hour column", () => {
    expect(formatTime(90_000)).toBe("1:30");
    expect(formatTime(9 * 60_000 + 5_000)).toBe("9:05");
    expect(formatTime(59 * 60_000 + 59_000)).toBe("59:59");
  });

  it("adds an hour column past one hour", () => {
    expect(formatTime(3_600_000)).toBe("1:00:00");
    expect(formatTime(75 * 60_000 + 30_000)).toBe("1:15:30");
    expect(formatTime(2 * 3_600_000 + 7 * 60_000 + 4_000)).toBe("2:07:04");
  });

  it("handles undefined, negative, and NaN input defensively", () => {
    expect(formatTime(undefined)).toBe("0:00");
    expect(formatTime(-5000)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
  });
});
