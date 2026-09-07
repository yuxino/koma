export type ProgressStepState = "done" | "current" | "waiting";

const englishProgressDetails: Readonly<Record<string, string>> = {
  "任务已经进入处理队列。": "Your video is queued for analysis.",
  "正在解析视频真实地址。": "Resolving the video URL.",
  "正在连接视频源。": "Connecting to the video source.",
  "视频已进入临时空间。": "Video download complete.",
  "正在读取视频尺寸和时长。": "Reading the video dimensions and duration.",
  "从视频里挑出几个视觉切片。": "Selecting key frames from the video.",
  "把声音整理成适合听写的轨道。": "Preparing the audio for transcription.",
  "正在做说话人分离与听写。": "Identifying speakers and transcribing the audio.",
  "视频没有声音，继续理解画面。": "No audio was found. Continuing with the video frames.",
  "把声音与画面放回同一条时间线。": "Combining the audio and frames on one timeline.",
  "演示听写正在生成。": "Generating a demo transcript.",
  "正在把视频放入临时空间。": "Downloading the video.",
  "正在把原视频保存到长期存储。": "Saving the original video for replay.",
  "正在保存关键帧和分析产物。": "Saving key frames and analysis files.",
  "分析已经完成。": "Analysis complete."
};

/** Translate the pipeline's known messages without replacing provider details. */
export function translateProgressDetail(detail: string | null | undefined, language: "en" | "zh"): string {
  if (typeof detail !== "string") return "";
  if (language === "zh") return detail;
  const message = detail.trim();
  const fixed = Object.hasOwn(englishProgressDetails, message) ? englishProgressDetails[message] : undefined;
  if (fixed) return fixed;
  const download = /^正在取回视频 (\d+) MB。$/.exec(message);
  if (download) return `Downloading video: ${download[1]} MB received.`;
  const retry = /^视频没有完整到达，正在重新取回（(\d+)\/(\d+)）。$/.exec(message);
  if (retry) return `The video download was incomplete. Retrying (${retry[1]}/${retry[2]}).`;
  const transcript = /^(.+) 正在生成逐句字幕。$/.exec(message);
  if (transcript) return `${transcript[1]} is generating the transcript.`;
  return detail;
}

const entryStages = new Set(["queued", "resolving", "downloading", "storing_video"]);
const analysisStages = new Set(["inspecting", "extracting_frames", "extracting_audio", "transcribing", "interpreting"]);

export function progressStepStates(stage: string, status: "queued" | "processing" | "done" | "failed", percent = 0): [ProgressStepState, ProgressStepState, ProgressStepState] {
  if (status === "done" || stage === "done") return ["done", "done", "done"];
  if (status === "failed" || stage === "failed") return ["waiting", "waiting", "waiting"];

  const fallbackIndex = percent >= 95 ? 2 : percent >= 12 ? 1 : 0;
  const currentIndex = entryStages.has(stage) ? 0 : analysisStages.has(stage) ? 1 : stage === "storing_results" ? 2 : fallbackIndex;
  return [0, 1, 2].map((index) => index < currentIndex ? "done" : index === currentIndex ? "current" : "waiting") as [ProgressStepState, ProgressStepState, ProgressStepState];
}
