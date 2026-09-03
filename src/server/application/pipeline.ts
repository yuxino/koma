import { mkdir, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { config } from "../config/config.js";
import { analyze } from "../analysis/analysis.js";
import { transcribe, transcribeFullAudio } from "../media/asr.js";
import { downloadUrl } from "../media/download.js";
import { flushJob, getJobAbortSignal, releaseWorkingDirectory, updateJob, type AnalysisResult, type Job, type JobProgress } from "./jobs.js";
import { resolveVideoUrl } from "../media/resolver.js";
import { createSemaphore } from "../shared/semaphore.js";
import { extractAudioSegments, extractFrames, inspectVideo } from "../media/video.js";
import type { AnalysisSpec } from "../analysis/analysis-spec.js";
import { getRuntimeProviders, type RuntimeProvider, type RuntimeProviders } from "../analysis/provider-runtime.js";
import type { AsrProvider } from "../config/config.js";
import { putStoredFile, putStoredText } from "../persistence/storage.js";

// 限制同时运行的分析任务数，超出部分排队等待。
// 多个大视频同时抽帧/转写会吃满 CPU 和内存，这里把它们串成有限并发。
const analysisSlots = createSemaphore(config.maxConcurrentJobs);

export function enqueueAnalysis(job: Job): void {
  setImmediate(async () => {
    const signal = getJobAbortSignal(job.id);
    if (signal?.aborted) return;
    await analysisSlots.acquire();
    try {
      if (signal?.aborted) return;
      await runAnalysis(job, signal);
    } catch (error) {
      // 管理员删除任务触发的 AbortError 不再回写失败记录。
      if (signal?.aborted) return;
      updateJob(job, { status: "failed", error: error instanceof Error ? error.message : String(error), progress: { stage: "failed", percent: 100, detail: error instanceof Error ? error.message : String(error) } });
    } finally {
      // Provider Key 完成调用后立即从任务内存移除；历史库从未保存明文 Key。
      job.providers = {
        asr: { ...job.providers.asr, apiKey: "" },
        vision: { ...job.providers.vision, apiKey: "" }
      };
      try {
        await releaseWorkingDirectory(job);
      } catch (error) {
        console.warn(`[koma] 无法完成任务收尾：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        analysisSlots.release();
      }
    }
  });
}

interface AnalyzeMediaOptions {
  inputPath: string;
  title: string;
  framesDir: string;
  audioDir: string;
  signal?: AbortSignal;
  language?: "en" | "zh";
  analysisSpec?: AnalysisSpec;
  providers?: RuntimeProviders;
  onProgress?: (progress: JobProgress) => void;
}

// 与 job 解耦的媒体分析管线，HTTP 任务与 headless CLI 共用。
// 输入文件与帧目录的生命周期由调用方负责；音频切片作为中间产物在这里即时清理。
export async function analyzeMedia({ inputPath, title, framesDir, audioDir, signal, language = "zh", analysisSpec = {}, providers = getRuntimeProviders(), onProgress = () => {} }: AnalyzeMediaOptions): Promise<AnalysisResult> {
  onProgress({ stage: "inspecting", percent: 12, detail: "正在读取视频尺寸和时长。" });
  const media = await inspectVideo(inputPath, { signal });
  if (!media.hasVideo) throw new Error("这个文件里没有视频画面，请换一个带画面的视频。");

  throwIfAborted(signal);
  onProgress({ stage: "extracting_frames", percent: 30, detail: "从视频里挑出几个视觉切片。" });
  const frames = await extractFrames(inputPath, framesDir, { signal, durationMs: media.durationMs });

  throwIfAborted(signal);
  onProgress({ stage: "extracting_audio", percent: 46, detail: "把声音整理成适合听写的轨道。" });
  await mkdir(audioDir, { recursive: true });
  let transcript: Awaited<ReturnType<typeof transcribe>> = [];
  if (media.hasAudio) {
    if (config.asrDiarization && providers.asr.provider === "dashscope") {
      onProgress({ stage: "transcribing", percent: 60, detail: "正在做说话人分离与听写。" });
      try {
        transcript = await transcribeFullAudio({ inputPath, audioDir, publicBaseUrl: config.publicBaseUrl, signal, providerConfig: providers.asr });
      } catch (error) {
        // 说话人分离只是给字幕加“说话人”标签的增强：它依赖公网地址和百炼异步任务，
        // 失败时降级为普通分段听写，保证字幕和总结仍然可用，而不是让整个分析失败。
        if (signal?.aborted) throw error;
        console.warn(`[koma] 说话人分离失败，降级为普通听写：${error instanceof Error ? error.message : String(error)}`);
        transcript = await transcribeSegments(inputPath, audioDir, media.durationMs, signal, onProgress, providers.asr);
      }
    } else {
      transcript = await transcribeSegments(inputPath, audioDir, media.durationMs, signal, onProgress, providers.asr);
    }
  } else {
    onProgress({ stage: "transcribing", percent: 65, detail: "视频没有声音，继续理解画面。" });
  }

  throwIfAborted(signal);
  onProgress({ stage: "interpreting", percent: 82, detail: "把声音与画面放回同一条时间线。" });
  const result = await analyze({ title, durationMs: media.durationMs, frames, transcript, framesDir, signal, language, analysisSpec, provider: providers.vision });
  result.hasSubtitles = Boolean(result.hasSubtitles || media.hasNativeSubtitles);
  await rm(audioDir, { recursive: true, force: true }).catch(() => undefined);
  return result;
}

// 普通分段听写：把音频切成段交给同步 Fun-ASR-Flash（base64 直传，无需公网地址）。
async function transcribeSegments(
  inputPath: string,
  audioDir: string,
  durationMs: number,
  signal: AbortSignal | undefined,
  onProgress: (progress: JobProgress) => void,
  provider: RuntimeProvider<AsrProvider>
): Promise<Awaited<ReturnType<typeof transcribe>>> {
  const audioSegments = await extractAudioSegments(inputPath, audioDir, durationMs, { signal });
  throwIfAborted(signal);
  onProgress({ stage: "transcribing", percent: 65, detail: provider.provider === "mock" ? "演示听写正在生成。" : `${provider.model} 正在生成逐句字幕。` });
  return audioSegments.length ? await transcribe({ audioSegments, durationMs, signal, provider: provider.provider, apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model }) : [];
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("分析已取消。", "AbortError");
}

async function runAnalysis(job: Job, signal?: AbortSignal): Promise<void> {
  const framesDir = join(job.dir, "frames");
  const audioDir = join(job.dir, "audio");
  let inputPath: string | undefined = job.inputPath;
  try {
    updateJob(job, { status: "processing" });
    if (job.sourceUrl) {
      // 视频地址任务：在后台解析真实地址并下载，全程回报进度，提交接口不再阻塞
      const resolved = await resolveVideoUrl(job.sourceUrl, { signal });
      if (resolved.title) updateJob(job, { title: resolved.title });
      throwIfAborted(signal);
      updateJob(job, { progress: { stage: "downloading", percent: 8, detail: "正在把视频放入临时空间。" } });
      inputPath = join(job.dir, "input.mp4");
      job.inputPath = inputPath;
      const download = await downloadUrl(resolved.url, inputPath, {
        referer: resolved.referer,
        signal,
        onProgress: (percent, detail) => updateJob(job, { progress: { stage: "downloading", percent, detail } })
      });
      job.inputMimeType = download.contentType;
    }
    if (!inputPath) throw new Error("视频文件尚未就绪。");
    throwIfAborted(signal);
    updateJob(job, { progress: { stage: "storing_video", percent: 10, detail: "正在把原视频保存到长期存储。" } });
    const inputExtension = extname(inputPath).toLowerCase().match(/^\.[a-z0-9]{2,5}$/)?.[0] || ".mp4";
    const inputObjectKey = `${job.storagePrefix}/video/source${inputExtension}`;
    await putStoredFile(inputObjectKey, inputPath, job.inputMimeType || "video/mp4");
    updateJob(job, { inputObjectKey, mediaAvailable: true });
    await flushJob(job);

    const result = await analyzeMedia({
      inputPath,
      title: job.title,
      framesDir,
      audioDir,
      signal,
      language: job.language,
      analysisSpec: job.analysisSpec,
      providers: job.providers,
      onProgress: (progress) => updateJob(job, { progress })
    });
    throwIfAborted(signal);
    updateJob(job, { progress: { stage: "storing_results", percent: 95, detail: "正在保存关键帧和分析产物。" } });
    await persistResultAssets(job, result, framesDir);
    updateJob(job, { status: "done", result, progress: { stage: "done", percent: 100, detail: "分析已经完成。" } });
    await flushJob(job);
  } finally {
    // 工作目录只承载处理中间文件；可回看的资产已进入持久存储。
    await rm(audioDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function persistResultAssets(job: Job, result: AnalysisResult, framesDir: string): Promise<void> {
  for (const frame of result.frames) {
    const objectKey = `${job.storagePrefix}/frames/${frame.filename}`;
    await putStoredFile(objectKey, join(framesDir, frame.filename), "image/jpeg");
    frame.storageKey = objectKey;
    delete frame.path;
  }
  for (const artifact of result.artifacts || []) {
    const safeName = artifact.name.replace(/[\\/]/g, "-");
    const objectKey = `${job.storagePrefix}/artifacts/${artifact.id}-${safeName}`;
    await putStoredText(objectKey, artifact.content, artifact.mimeType);
    artifact.storageKey = objectKey;
  }
}
