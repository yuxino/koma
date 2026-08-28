import { describe, expect, it } from "vitest";
import { translateServerError } from "./errors.js";

describe("translateServerError", () => {
  it("passes Chinese messages through unchanged in Chinese mode", () => {
    expect(translateServerError("视频太大了，第一版最多支持 500 MB。", "zh")).toBe("视频太大了，第一版最多支持 500 MB。");
  });

  it("maps known server errors to English", () => {
    expect(translateServerError("视频太大了，第一版最多支持 500 MB。", "en")).toBe("Video is too large. Reduce the file size or pick a shorter video.");
    expect(translateServerError("这个文件里没有视频画面，请换一个带画面的视频。", "en")).toBe("This file has no video track. Please choose a video with visuals.");
    expect(translateServerError("这次分析已经消失了。", "en")).toBe("This analysis is no longer available.");
    expect(translateServerError("今天的公开演示次数已经用完，请明天再来。", "en")).toContain("public demo allowance");
    expect(translateServerError("请先登录管理后台，再开始生成或分析。", "en")).toContain("administrator");
    expect(translateServerError("管理员登录已失效，请重新登录。", "en")).toContain("administrator");
    expect(translateServerError("管理请求校验失败。", "en")).toContain("Refresh Koma");
    expect(translateServerError("画面模型没有按要求返回结构化提取结果，请重试。", "en")).toContain("structured data");
    expect(translateServerError("自定义结构化提取需要配置真实的视觉模型。", "en")).toContain("requires a configured vision model");
    expect(translateServerError("生成 JSON 配置时模型请求失败，请稍后重试。", "en")).toContain("JSON shape");
    expect(translateServerError("模型没有返回可用的 JSON 配置，请调整描述后重试。", "en")).toContain("JSON shape");
    expect(translateServerError("生成 JSON 配置需要先配置真实的视觉模型。", "en")).toContain("configured vision model");
  });

  it("maps speaker diarization errors to English", () => {
    expect(translateServerError("听写任务提交失败：401", "en")).toBe("Transcription failed. Please try again.");
    expect(translateServerError("听写任务失败：音频无法下载", "en")).toBe("Transcription failed. Please try again.");
    expect(translateServerError("听写任务没有返回任务编号。", "en")).toBe("The transcription service did not return a task id.");
    expect(translateServerError("听写结果下载失败：500", "en")).toBe("Could not download the transcription result. Please try again.");
    expect(translateServerError("说话人分离需要配置 PUBLIC_BASE_URL（服务的公网地址）。", "en")).toContain("PUBLIC_BASE_URL");
  });

  it("falls back to a generic English message for unknown errors", () => {
    expect(translateServerError("某种未收录的错误", "en")).toBe("Something went wrong. Please try again.");
  });

  it("returns an empty string for empty input", () => {
    expect(translateServerError("", "en")).toBe("");
    expect(translateServerError(undefined, "en")).toBe("");
    expect(translateServerError(null, "en")).toBe("");
  });
});
