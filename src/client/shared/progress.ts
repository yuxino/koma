export type ProgressStepState = "done" | "current" | "waiting";

const entryStages = new Set(["queued", "resolving", "downloading", "storing_video"]);
const analysisStages = new Set(["inspecting", "extracting_frames", "extracting_audio", "transcribing", "interpreting"]);

export function progressStepStates(stage: string, status: "queued" | "processing" | "done" | "failed", percent = 0): [ProgressStepState, ProgressStepState, ProgressStepState] {
  if (status === "done" || stage === "done") return ["done", "done", "done"];
  if (status === "failed" || stage === "failed") return ["waiting", "waiting", "waiting"];

  const fallbackIndex = percent >= 95 ? 2 : percent >= 12 ? 1 : 0;
  const currentIndex = entryStages.has(stage) ? 0 : analysisStages.has(stage) ? 1 : stage === "storing_results" ? 2 : fallbackIndex;
  return [0, 1, 2].map((index) => index < currentIndex ? "done" : index === currentIndex ? "current" : "waiting") as [ProgressStepState, ProgressStepState, ProgressStepState];
}
