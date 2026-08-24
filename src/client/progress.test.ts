import { describe, expect, it } from "vitest";
import { progressStepStates } from "./progress.js";

describe("progressStepStates", () => {
  it.each([
    ["downloading", "processing", 9, ["current", "waiting", "waiting"]],
    ["transcribing", "processing", 65, ["done", "current", "waiting"]],
    ["storing_results", "processing", 95, ["done", "done", "current"]],
    ["done", "done", 100, ["done", "done", "done"]],
    ["failed", "failed", 100, ["waiting", "waiting", "waiting"]],
    ["future_analysis_stage", "processing", 82, ["done", "current", "waiting"]]
  ] as const)("maps %s to the visible three-step sequence", (stage, status, percent, expected) => {
    expect(progressStepStates(stage, status, percent)).toEqual(expected);
  });
});
