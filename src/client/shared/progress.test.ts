import { describe, expect, it } from "vitest";
import { progressStepStates, translateProgressDetail } from "./progress.js";

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

describe("translateProgressDetail", () => {
  it.each([
    ["任务已经进入处理队列。", "Your video is queued for analysis."],
    ["正在解析视频真实地址。", "Resolving the video URL."],
    ["正在连接视频源。", "Connecting to the video source."],
    ["视频已进入临时空间。", "Video download complete."],
    ["正在读取视频尺寸和时长。", "Reading the video dimensions and duration."],
    ["从视频里挑出几个视觉切片。", "Selecting key frames from the video."],
    ["把声音整理成适合听写的轨道。", "Preparing the audio for transcription."],
    ["正在做说话人分离与听写。", "Identifying speakers and transcribing the audio."],
    ["视频没有声音，继续理解画面。", "No audio was found. Continuing with the video frames."],
    ["把声音与画面放回同一条时间线。", "Combining the audio and frames on one timeline."],
    ["演示听写正在生成。", "Generating a demo transcript."],
    ["正在把视频放入临时空间。", "Downloading the video."],
    ["正在把原视频保存到长期存储。", "Saving the original video for replay."],
    ["正在保存关键帧和分析产物。", "Saving key frames and analysis files."],
    ["分析已经完成。", "Analysis complete."]
  ])("translates the fixed pipeline message %s", (chinese, english) => {
    expect(translateProgressDetail(chinese, "en")).toBe(english);
    expect(translateProgressDetail(chinese, "zh")).toBe(chinese);
  });

  it.each([
    ["正在取回视频 0 MB。", "Downloading video: 0 MB received."],
    ["正在取回视频 203 MB。", "Downloading video: 203 MB received."],
    ["视频没有完整到达，正在重新取回（2/3）。", "The video download was incomplete. Retrying (2/3)."],
    ["fun-asr-flash 正在生成逐句字幕。", "fun-asr-flash is generating the transcript."],
    ["Provider/model-v2 (fast) 正在生成逐句字幕。", "Provider/model-v2 (fast) is generating the transcript."]
  ])("preserves the live values in %s", (chinese, english) => {
    expect(translateProgressDetail(chinese, "en")).toBe(english);
    expect(translateProgressDetail(chinese, "zh")).toBe(chinese);
  });

  it("keeps unknown provider details and already-English messages unchanged", () => {
    for (const message of ["Provider X: rate_limit=429, retry_after=30", "未知提供方：任务暂挂，编号 abc-123", "  provider details\nnext attempt in 20 s  ", "备注：正在取回视频 20 MB。", "正在取回视频 many MB。", "__proto__", "constructor"])
      expect(translateProgressDetail(message, "en")).toBe(message);
    expect(translateProgressDetail("  正在连接视频源。  ", "zh")).toBe("  正在连接视频源。  ");
  });

  it("lets the view supply its existing preparation fallback for missing details", () => {
    expect(translateProgressDetail(undefined, "en")).toBe("");
    expect(translateProgressDetail(null, "zh")).toBe("");
    expect(translateProgressDetail("", "en")).toBe("");
  });
});
