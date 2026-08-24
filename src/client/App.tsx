import { useEffect, useRef, useState, type ReactNode, type RefObject, type FormEvent, type DragEvent, type KeyboardEvent, type ChangeEvent } from "react";
import { translateServerError } from "./errors.js";
import { formatTime } from "./format.js";
import { progressStepStates } from "./progress.js";

type Language = "en" | "zh";

type Stage = "queued" | "resolving" | "downloading" | "inspecting" | "extracting_frames" | "extracting_audio" | "transcribing" | "interpreting" | "done" | "failed" | string;

const copy = {
  en: {
    stage: {
      queued: "Queued",
      resolving: "Resolving link",
      downloading: "Fetching video",
      inspecting: "Reading video",
      extracting_frames: "Extracting frames",
      extracting_audio: "Preparing audio",
      transcribing: "Transcribing",
      interpreting: "Generating summary",
      storing_video: "Saving video",
      storing_results: "Saving results",
      done: "Complete",
      failed: "Try again"
    } as Record<string, string>,
    help: "How it works",
    admin: "Manage",
    history: "My jobs",
    historyTitle: "My analysis history",
    historyText: "Jobs submitted from this browser. Open a result or permanently delete its video and files.",
    historyEmpty: "No analyses have been submitted from this browser yet.",
    historyLoading: "Loading your jobs…",
    openResult: "Open",
    deleteOwn: "Delete",
    deleting: "Deleting…",
    confirmDeleteOwn: "Permanently delete this analysis, its video, key frames, and generated files? This cannot be undone.",
    deleteFailed: "Could not delete this analysis.",
    badge: "VIDEO INTELLIGENCE WORKSPACE",
    hero: "Turn video into data you can use.",
    intro: "Give Koma a video. Get the moments, subtitles, summary, or specific information you actually need.",
    mascotCue: "Your frame editor is ready.",
    mascotCueText: "I watch the frames, listen to the audio, and arrange every useful finding on the timeline.",
    flowVideo: "VIDEO",
    flowSignals: "AUDIO + FRAMES",
    flowOutput: "DATA + FILES",
    homeUnderstand: "Understand",
    homeUnderstandSub: "Summary, chapters, subtitles, and key moments",
    homeExtract: "Extract",
    homeExtractSub: "Structured JSON shaped to your exact request",
    homeDeliver: "Deliver",
    homeDeliverSub: "JSON, CSV, Markdown, SRT, and TXT outputs",
    newAnalysis: "NEW ANALYSIS",
    startOne: "Start an analysis",
    sourceLabel: "Video source",
    upload: "Upload",
    videoUrl: "Video URL",
    drop: "Drop a video here, or choose a file",
    ready: "Ready",
    publicUrl: "Public video URL",
    urlPlaceholder: "https://v.douyin.com/… or a direct video URL",
    urlHint: "Supports Douyin share links, Bilibili, YouTube and other public video URLs.",
    temporary: "Saved for permanent replay",
    customExtract: "Advanced options",
    customHint: "Open only when you need custom fields, instructions, or file formats",
    advancedDescription: "Customize the analysis request, JSON shape, and downloadable file formats without changing the main page.",
    advancedConfigured: "Configured",
    advancedRequirement: "Custom request",
    cancelSettings: "Cancel",
    applySettings: "Apply settings",
    presetsLabel: "What do you need?",
    presetsHint: "Optional · Skip this for a complete summary, chapters, and subtitles",
    analysisRequirement: "Analysis requirement",
    instructionPlaceholder: "Example: Extract every product mentioned, its price, and the first timestamp where it appears.",
    outputShape: "Expected JSON shape (optional)",
    schemaPlaceholder: '{\n  "products": [\n    { "name": "string", "price": 0, "atMs": 0 }\n  ]\n}',
    schemaHint: "Paste a JSON example or JSON Schema. Field names and nesting will be preserved.",
    outputFiles: "Downloadable files (optional)",
    outputFilesHint: "Generate complete text files from the same analysis. Select more than one if needed.",
    invalidSchema: "The expected JSON shape is not valid JSON.",
    starting: "Starting…",
    start: "Analyze video",
    retry: "Try again",
    uploading: "Uploading",
    uploadProgress: "Uploading video",
    missingFile: "Choose a video first.",
    missingUrl: "Paste a video URL first.",
    startFailed: "Could not start the analysis.",
    jobMissing: "This analysis could not be found.",
    analyzingRemote: "ANALYZING · REMOTE VIDEO",
    analyzingLocal: "ANALYZING · LOCAL VIDEO",
    progressTitle: "Turning this video into something you can scan.",
    progressText: "Audio, frames, and timing are being combined into one result you can jump through.",
    processing: "Processing",
    preparing: "Preparing…",
    entered: "Video received",
    mediaAnalysis: "Analyzing audio and visuals",
    readableResult: "Building the result",
    cancel: "Back home (keep running)",
    completed: "ANALYSIS COMPLETE",
    resultFallback: "What is worth remembering from this video?",
    restart: "Start over",
    clear: "Copy replay link",
    linkCopied: "Link copied",
    aiSummary: "AI SUMMARY",
    structuredData: "REQUESTED DATA",
    structuredDataSub: "Returned in the JSON shape you requested",
    copyJson: "Copy JSON",
    copied: "Copied",
    downloadJson: "Download JSON",
    generatedFiles: "GENERATED FILES",
    generatedFilesSub: "Download ready-to-use analysis outputs",
    downloadFile: "Download",
    duration: "Duration",
    frames: "Key frames",
    subtitleLines: "Subtitle lines",
    autoDelete: "Replay",
    replayReady: "Saved",
    contentTags: "Content tags",
    jumpTag: "Click to jump to the first appearance",
    browserNoVideo: "Your browser cannot play this video.",
    speaker: "Speaker",
    voice: "Voice",
    subtitlesToggle: "Subtitles",
    subtitlesOn: "Turn subtitles off",
    subtitlesOff: "Turn subtitles on",
    reviewing: "Reviewing video",
    frameTimeline: "Key frame timeline",
    keyFrameGallery: "Key frame gallery",
    keyFrameGallerySub: "Click any frame to enlarge and inspect it",
    clickToEnlarge: "Click to enlarge",
    openOriginal: "Open original",
    previousFrame: "Previous frame",
    nextFrame: "Next frame",
    jumpTo: "Jump to",
    keyFrame: "key frame",
    chapters: "Chapter summary",
    chaptersSub: "Click a chapter to jump to that part of the video",
    chaptersCount: "chapters",
    noChapters: "No chapter summary was generated for this video.",
    backHome: "Back to home",
    framePreview: "Key frame preview",
    playThisMoment: "Play this moment",
    subtitlePanel: "Subtitles",
    subtitlePanelText: "One line at a time. Click any subtitle to jump back to it.",
    playFrom: "Play from",
    noSpeech: "No usable speech was detected in this video.",
    remaining: "Permanent replay · manage your own jobs from this browser",
    close: "Close",
    aboutTitle: "How to use Koma",
    aboutText: "From a video to a replayable analysis and ready-to-use files.",
    aboutSteps: [
      { title: "1 · Submit a video", text: "Upload a local video or paste a public URL. Pick an outcome if you need structured information, subtitles, or a report; otherwise just start the analysis." },
      { title: "2 · Review the result", text: "Koma combines audio and key frames into a summary, chapters, tags, subtitles, structured data, and generated files. Click any timestamp, subtitle, chapter, tag, or key frame to return to that moment." },
      { title: "3 · Return from My jobs", text: "My jobs lists analyses submitted from this browser. You can reopen a running or completed job and permanently delete your own video, frames, result, and generated files." },
      { title: "4 · Share or administer", text: "Anyone with an unguessable replay link can view the result but cannot delete it. Administrators use Manage to configure providers and encrypted keys, inspect every job's request and result, and perform global deletion." }
    ],
    aboutMuted: "Browser ownership is anonymous and stored in an HttpOnly cookie. Clearing site data or switching browsers/devices removes access to My jobs, but saved replay links still work. Jobs created before this feature remain admin-only.",
    gotIt: "Got it",
    language: "中文"
  },
  zh: {
    stage: {
      queued: "排队中",
      resolving: "解析链接",
      downloading: "取回视频",
      inspecting: "读取视频",
      extracting_frames: "抽取画面",
      extracting_audio: "整理声音",
      transcribing: "听写字幕",
      interpreting: "生成总结",
      storing_video: "保存视频",
      storing_results: "保存结果",
      done: "分析完成",
      failed: "需要重试"
    } as Record<string, string>,
    help: "使用说明",
    admin: "管理",
    history: "我的任务",
    historyTitle: "我的分析记录",
    historyText: "显示这个浏览器提交的任务，可以回看结果，也可以永久删除视频和相关文件。",
    historyEmpty: "这个浏览器还没有提交过分析任务。",
    historyLoading: "正在读取任务记录…",
    openResult: "打开",
    deleteOwn: "删除",
    deleting: "正在删除…",
    confirmDeleteOwn: "确定永久删除这次分析、原视频、关键帧和生成文件吗？删除后无法恢复。",
    deleteFailed: "没有成功删除这次分析。",
    badge: "视频理解与数据提取工作台",
    hero: "把视频，变成可以使用的数据。",
    intro: "给 Koma 一段视频，得到关键内容、字幕、总结，或者你真正需要的信息。",
    mascotCue: "逐帧整理员已就位。",
    mascotCueText: "我会同时看画面、听声音，再把有用的内容按时间码整理好。",
    flowVideo: "视频",
    flowSignals: "声音 + 画面",
    flowOutput: "数据 + 文件",
    homeUnderstand: "理解内容",
    homeUnderstandSub: "总结、章节、字幕与关键瞬间",
    homeExtract: "提取数据",
    homeExtractSub: "严格按要求返回结构化 JSON",
    homeDeliver: "生成文件",
    homeDeliverSub: "输出 JSON、CSV、Markdown、SRT、TXT",
    newAnalysis: "NEW ANALYSIS",
    startOne: "开始一次分析",
    sourceLabel: "视频来源",
    upload: "本地视频",
    videoUrl: "视频地址",
    drop: "拖进来，或点这里选择",
    ready: "已准备好",
    publicUrl: "公开的视频地址",
    urlPlaceholder: "https://v.douyin.com/… 或视频直链",
    urlHint: "支持抖音分享链接、B站、YouTube 等公开链接与视频直链。",
    temporary: "保存为可永久回看的任务",
    customExtract: "高级设置",
    customHint: "只有需要自定义字段、要求或文件格式时才打开",
    advancedDescription: "在这里自定义分析要求、JSON 结构和输出文件，不会改变首页长度。",
    advancedConfigured: "已配置",
    advancedRequirement: "自定义要求",
    cancelSettings: "取消",
    applySettings: "应用设置",
    presetsLabel: "你想得到什么？",
    presetsHint: "可选 · 不选择也会生成完整总结、章节和字幕",
    analysisRequirement: "分析要求",
    instructionPlaceholder: "例如：提取视频中出现的所有商品、价格，以及首次出现的时间。",
    outputShape: "期望 JSON 结构（可选）",
    schemaPlaceholder: '{\n  "products": [\n    { "name": "string", "price": 0, "atMs": 0 }\n  ]\n}',
    schemaHint: "可粘贴 JSON 示例或 JSON Schema；字段名和嵌套结构会被保留。",
    outputFiles: "输出文件（可选）",
    outputFilesHint: "基于同一次分析生成完整文本文件，可以多选。",
    invalidSchema: "期望 JSON 结构不是有效 JSON。",
    starting: "正在放入…",
    start: "开始分析",
    retry: "重试",
    uploading: "正在上传",
    uploadProgress: "正在上传视频",
    missingFile: "先放入一个小视频",
    missingUrl: "先粘贴一个视频地址",
    startFailed: "没有成功开始分析",
    jobMissing: "找不到这次分析",
    analyzingRemote: "ANALYZING · REMOTE VIDEO",
    analyzingLocal: "ANALYZING · LOCAL VIDEO",
    progressTitle: "正在把视频整理成可读结果。",
    progressText: "声音、画面和时间线正在临时空间里汇合，完成后可以直接点着回看。",
    processing: "处理中",
    preparing: "正在准备…",
    entered: "视频已进入临时空间",
    mediaAnalysis: "声音与画面分析",
    readableResult: "生成可读结果",
    cancel: "返回首页（任务继续）",
    completed: "分析完成",
    resultFallback: "这段视频，留下了什么？",
    restart: "重新开始",
    clear: "复制回看链接",
    linkCopied: "链接已复制",
    aiSummary: "AI 视频总结",
    structuredData: "按要求提取的数据",
    structuredDataSub: "按你指定的 JSON 结构返回",
    copyJson: "复制 JSON",
    copied: "已复制",
    downloadJson: "下载 JSON",
    generatedFiles: "生成的文件",
    generatedFilesSub: "可直接下载使用的分析产物",
    downloadFile: "下载",
    duration: "视频时长",
    frames: "关键画面",
    subtitleLines: "字幕句数",
    autoDelete: "回看状态",
    replayReady: "已保存",
    contentTags: "内容标签",
    jumpTag: "点击跳到首次出现的位置",
    browserNoVideo: "你的浏览器暂时无法播放这段视频。",
    speaker: "说话人",
    voice: "人声",
    subtitlesToggle: "字幕",
    subtitlesOn: "关闭字幕",
    subtitlesOff: "开启字幕",
    reviewing: "正在回看视频",
    frameTimeline: "关键帧时间线",
    keyFrameGallery: "关键帧画廊",
    keyFrameGallerySub: "点击任意关键帧即可放大查看",
    clickToEnlarge: "点击放大",
    openOriginal: "查看原图",
    previousFrame: "上一张关键帧",
    nextFrame: "下一张关键帧",
    jumpTo: "跳到",
    keyFrame: "关键帧",
    chapters: "内容章节",
    chaptersSub: "点击章节跳到对应内容",
    chaptersCount: "个章节",
    noChapters: "这次没有生成章节总结。",
    backHome: "回到首页",
    framePreview: "关键帧预览",
    playThisMoment: "播放这一刻",
    subtitlePanel: "字幕",
    subtitlePanelText: "每句一行，点击直接跳回对应位置。",
    playFrom: "从",
    noSpeech: "这段视频没有识别到可用人声。",
    remaining: "永久回看 · 可在这个浏览器管理自己的任务",
    close: "关闭",
    aboutTitle: "如何使用 Koma",
    aboutText: "从一段视频，得到可回看、可定位、可下载的完整分析结果。",
    aboutSteps: [
      { title: "1 · 提交视频", text: "上传本地视频或粘贴公开视频地址。需要信息、字幕或报告时可以选一个结果类型；只想快速理解内容则直接开始分析。" },
      { title: "2 · 查看分析结果", text: "Koma 会结合声音和关键帧生成总结、章节、标签、字幕、结构化数据与文件。点击时间、字幕、章节、标签或关键帧，都能跳回视频对应位置。" },
      { title: "3 · 从“我的任务”回来", text: "“我的任务”会列出这个浏览器提交的分析。可以重新打开执行中或已完成的任务，也可以永久删除自己的原视频、关键帧、结果和生成文件。" },
      { title: "4 · 分享与管理", text: "拿到不可猜回看链接的人可以查看结果，但不能删除。管理员从“管理”进入后台，配置 Provider 和加密 Key，查看全部任务的要求与结果，并执行全局删除。" }
    ],
    aboutMuted: "用户归属通过 HttpOnly 匿名 Cookie 保存在当前浏览器。清除网站数据或换浏览器、换设备后，“我的任务”不会同步，但保存的回看链接仍可使用；此功能上线前的旧任务只在管理后台显示。",
    gotIt: "知道了",
    language: "EN"
  }
} as const;

interface JobProgress { stage: Stage; percent: number; detail: string; }
interface TranscriptLine { startMs: number; endMs: number; text: string; speaker?: string; }
interface Frame { filename: string; atMs: number; caption?: string; url: string; }
interface Chapter { startMs: number; endMs: number; title: string; summary: string; }
interface Tag { label: string; category: string; atMs: number; }
type ArtifactFormat = "json" | "csv" | "markdown" | "srt" | "text";
interface Artifact { id: string; name: string; format: ArtifactFormat; mimeType: string; language?: string; sizeBytes: number; downloadUrl: string; }
interface AnalysisResult { title: string; durationMs: number; summary: string; tags: Tag[]; chapters: Chapter[]; transcript: TranscriptLine[]; hasSubtitles?: boolean; frames: Frame[]; videoUrl: string; extractedData?: unknown; artifacts?: Artifact[]; }
interface Job { id: string; source: "upload" | "url"; title: string; createdAt: number; updatedAt: number; completedAt?: number | null; status: "queued" | "processing" | "done" | "failed"; progress: JobProgress; analysisSpec?: { instruction?: string; outputSchema?: unknown; artifactFormats?: ArtifactFormat[] }; result: AnalysisResult | null; error: string | null; owned?: boolean; }
interface JobHistoryItem { id: string; source: "upload" | "url"; title: string; status: Job["status"]; progress: JobProgress; createdAt: number; updatedAt: number; completedAt?: number | null; mediaAvailable: boolean; error: string | null; }
interface ServiceInfo { limits?: { maxUploadBytes?: number; maxDurationSeconds?: number }; }
interface AnalysisPreset { id: "extract" | "subtitles" | "report"; label: string; description: string; instruction: string; outputSchema?: unknown; formats: ArtifactFormat[]; }

function analysisPresets(language: Language): AnalysisPreset[] {
  if (language === "zh") return [
    {
      id: "extract", label: "提取信息", description: "人物、商品、数字与时间点", formats: ["json", "csv"],
      instruction: "提取视频中出现的关键人物、组织、商品、数字和重要观点，并记录每项首次出现的时间。只返回视频中有明确依据的信息。",
      outputSchema: { items: [{ type: "string", name: "string", value: "string", evidence: "string", atMs: 0 }] }
    },
    {
      id: "subtitles", label: "双语字幕", description: "可下载的中英文字幕", formats: ["srt"],
      instruction: "生成两份完整 SRT 字幕：zh-CN.srt 使用简体中文，en-US.srt 使用自然英文。保留准确时间轴，不遗漏有意义的口语内容。"
    },
    {
      id: "report", label: "整理报告", description: "摘要、结论与行动项", formats: ["markdown"],
      instruction: "生成一份结构清晰的中文 Markdown 报告，包含执行摘要、核心观点、关键证据及时间点、结论和可执行行动项。"
    }
  ];
  return [
    {
      id: "extract", label: "Extract information", description: "People, products, numbers, and moments", formats: ["json", "csv"],
      instruction: "Extract the key people, organizations, products, numbers, and claims in the video, including the first timestamp for each item. Include only information supported by the video.",
      outputSchema: { items: [{ type: "string", name: "string", value: "string", evidence: "string", atMs: 0 }] }
    },
    {
      id: "subtitles", label: "Bilingual subtitles", description: "Download Chinese and English captions", formats: ["srt"],
      instruction: "Generate two complete SRT subtitle files: zh-CN.srt in Simplified Chinese and en-US.srt in natural English. Preserve accurate timing and all meaningful speech."
    },
    {
      id: "report", label: "Organized report", description: "Summary, findings, and actions", formats: ["markdown"],
      instruction: "Create a well-structured English Markdown report with an executive summary, key findings, timestamped evidence, conclusions, and actionable next steps."
    }
  ];
}

function parseOutputSchema(value: string, errorMessage: string): unknown {
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") throw new Error(errorMessage);
    return parsed;
  } catch {
    throw new Error(errorMessage);
  }
}

function formatDate(timestamp: number, language: Language): string {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

type GlyphName = "arrow" | "clock" | "frame" | "info" | "link" | "play" | "spark" | "trash" | "upload" | "voice" | "cc" | "zoom" | "settings";
function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  const icons: Record<GlyphName, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>, clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    frame: <><path d="M8 3H4a1 1 0 0 0-1 1v4" /><path d="M16 3h4a1 1 0 0 1 1 1v4" /><path d="M8 21H4a1 1 0 0 1-1-1v-4" /><path d="M16 21h4a1 1 0 0 0 1-1v-4" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>, link: <><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" /><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15" /></>,
    play: <path d="m9 7 8 5-8 5Z" />, spark: <><path d="m12 3 1.2 4.1a5 5 0 0 0 3.7 3.7L21 12l-4.1 1.2a5 5 0 0 0-3.7 3.7L12 21l-1.2-4.1a5 5 0 0 0-3.7-3.7L3 12l4.1-1.2a5 5 0 0 0 3.7-3.7Z" /></>,
    trash: <><path d="M4 7h16" /><path d="m9 7 1-3h4l1 3" /><path d="m6 7 1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></>, upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>,
    voice: <><path d="M9 5v14" /><path d="M5 9v6" /><path d="M13 8v8" /><path d="M17 6v12" /><path d="M21 10v4" /></>, cc: <><rect x="2" y="6" width="20" height="12" rx="2.5" /><path d="M8.6 10.2c-.5-.5-1.1-.7-1.7-.7-1.7 0-3 .9-3 2.5s1.3 2.5 3 2.5c.6 0 1.2-.2 1.7-.7" /><path d="M15.6 10.2c-.5-.5-1.1-.7-1.7-.7-1.7 0-3 .9-3 2.5s1.3 2.5 3 2.5c.6 0 1.2-.2 1.7-.7" /></>,
    zoom: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.2 4.2" /><path d="M10.8 7.8v6M7.8 10.8h6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>
  };
  return <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

function Brand({ onClick, label }: { onClick?: () => void; label?: string }) {
  return onClick
    ? <button type="button" className="brand-lockup brand-button" onClick={onClick} aria-label={label}><img src="/koma-icon-64.png" alt="" className="brand-icon" /><span className="brand-text"><strong>Koma</strong><span>FRAME ATELIER</span></span></button>
    : <div className="brand-lockup"><img src="/koma-icon-64.png" alt="" className="brand-icon" /><div><strong>Koma</strong><span>FRAME ATELIER</span></div></div>;
}

function App() {
  const [language, setLanguage] = useState<Language>(() => window.localStorage.getItem("koma-language") === "zh" ? "zh" : "en");
  const t = copy[language];
  const [mode, setMode] = useState<"upload" | "url">("url");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [outputSchema, setOutputSchema] = useState("");
  const [artifactFormats, setArtifactFormats] = useState<ArtifactFormat[]>([]);
  const [activePreset, setActivePreset] = useState<AnalysisPreset["id"] | null>(null);
  const [serviceInfo, setServiceInfo] = useState<ServiceInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const advancedTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const hasResult = job?.status === "done" && job.result;
  const progress = job?.progress?.percent ?? 0;
  const maxMinutes = Math.max(1, Math.round((serviceInfo?.limits?.maxDurationSeconds || 15 * 60) / 60));
  const maxMegabytes = Math.max(1, Math.round((serviceInfo?.limits?.maxUploadBytes || 500 * 1024 * 1024) / 1024 / 1024));
  const fileHint = language === "zh" ? `MP4、MOV、WebM · 最长 ${maxMinutes} 分钟 / ${maxMegabytes} MB` : `MP4, MOV, WebM · up to ${maxMinutes} min / ${maxMegabytes} MB`;
  const sourceError = error === t.missingFile || error === t.missingUrl;
  const hasAdvancedSettings = Boolean(instruction.trim() || outputSchema.trim() || artifactFormats.length);
  const advancedSummaryParts = Array.from(new Set([instruction.trim() ? t.advancedRequirement : "", outputSchema.trim() ? "JSON" : "", ...artifactFormats.map((format) => format === "markdown" ? "MD" : format.toUpperCase())].filter(Boolean)));
  const advancedSummary = hasAdvancedSettings ? `${t.advancedConfigured} · ${advancedSummaryParts.join(" + ")}` : t.customHint;

  useEffect(() => {
    window.localStorage.setItem("koma-language", language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = language === "zh" ? "Koma — AI 视频理解" : "Koma — AI Video Understanding";
  }, [language]);

  useEffect(() => {
    if (!activePreset) return;
    const preset = analysisPresets(language).find((item) => item.id === activePreset);
    if (!preset) return;
    setInstruction(preset.instruction);
    setOutputSchema(preset.outputSchema === undefined ? "" : JSON.stringify(preset.outputSchema, null, 2));
    setArtifactFormats([...preset.formats]);
  }, [language, activePreset]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<ServiceInfo> : null)
      .then((info) => { if (info) setServiceInfo(info); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!showMoreMenu) return;
    function handlePointerDown(event: globalThis.PointerEvent) {
      if (moreMenuRef.current?.contains(event.target as Node)) return;
      setShowMoreMenu(false);
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setShowMoreMenu(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showMoreMenu]);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/jobs\/([a-f0-9-]{20,64})\/?$/i);
    if (!match) return undefined;
    const controller = new AbortController();
    setBusy(true);
    fetch(`/api/jobs/${match[1]}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? t.jobMissing : t.startFailed);
        setJob(await response.json() as Job);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!job?.id || job.status === "done" || job.status === "failed") return undefined;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (response.status === 404) {
          // 管理员可能删除任务：停止轮询，标记为失败而不是重复请求。
          setJob((current) => current ? { ...current, status: "failed", error: t.jobMissing } : current);
          return;
        }
        if (!response.ok) throw new Error(t.jobMissing);
        setJob(await response.json() as Job);
      } catch (pollError) { setError(translateServerError(pollError instanceof Error ? pollError.message : String(pollError), language)); }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status, language, t.jobMissing]);

  async function startAnalysis(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setError(""); setJob(null); setUploadPercent(null);
    try {
      const parsedOutputSchema = parseOutputSchema(outputSchema, t.invalidSchema);
      if (mode === "upload") {
        if (!file) throw new Error(t.missingFile);
        const jobId = await uploadWithProgress(file, parsedOutputSchema);
        const jobResponse = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        setJob(await jobResponse.json() as Job);
        window.history.replaceState({}, "", `/jobs/${jobId}`);
      } else {
        if (!url.trim()) throw new Error(t.missingUrl);
        const response = await fetch("/api/analyze/url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim(), lang: language, instruction: instruction.trim() || undefined, outputSchema: parsedOutputSchema, artifactFormats }) });
        const body = await response.json().catch(() => ({})) as { jobId?: string; error?: string };
        if (!response.ok) throw new Error(body.error || t.startFailed);
        const jobResponse = await fetch(`/api/jobs/${body.jobId}`, { cache: "no-store" });
        setJob(await jobResponse.json() as Job);
        window.history.replaceState({}, "", `/jobs/${body.jobId}`);
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      const clientMessage = message === t.missingFile || message === t.missingUrl || message === t.invalidSchema;
      setError(clientMessage ? message : translateServerError(message, language));
      if (message === t.missingUrl) urlInputRef.current?.focus();
      if (message === t.missingFile) dropZoneRef.current?.focus();
    } finally { setBusy(false); setUploadPercent(null); }
  }

  // 用 XMLHttpRequest 上传以拿到真实进度；返回创建的任务 id。
  function uploadWithProgress(video: File, parsedOutputSchema: unknown): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/analyze/upload?lang=${language}`);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadPercent(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onload = () => {
        let body: { jobId?: string; error?: string } = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* 保留空对象走错误分支 */ }
        if (xhr.status >= 200 && xhr.status < 300 && body.jobId) return resolve(body.jobId);
        reject(new Error(body.error || t.startFailed));
      };
      xhr.onerror = () => reject(new Error(t.startFailed));
      const formData = new FormData();
      // @fastify/multipart exposes fields already received when request.file() resolves,
      // so append extraction fields before the video part.
      if (instruction.trim()) formData.append("instruction", instruction.trim());
      if (parsedOutputSchema !== undefined) formData.append("outputSchema", JSON.stringify(parsedOutputSchema));
      if (artifactFormats.length) formData.append("artifactFormats", JSON.stringify(artifactFormats));
      formData.append("video", video);
      xhr.send(formData);
    });
  }

  async function retryAnalysis() {
    // 失败后重试：重新提交同一个来源（本地文件或视频地址）。
    await startAnalysis();
  }

  async function openHistoryJob(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 404 ? t.jobMissing : t.startFailed);
      setJob(await response.json() as Job);
      setShowHistory(false);
      window.history.pushState({}, "", `/jobs/${id}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) {
      setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language));
    } finally { setBusy(false); }
  }

  async function deleteOwnedJob(id: string): Promise<boolean> {
    if (!window.confirm(t.confirmDeleteOwn)) return false;
    const response = await fetch(`/api/my/jobs/${id}`, { method: "DELETE", headers: { "x-koma-user": "1" } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || t.deleteFailed);
    }
    if (job?.id === id) leaveJob();
    return true;
  }

  function leaveJob() { setJob(null); setFile(null); setUrl(""); setError(""); window.history.pushState({}, "", "/"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function restartAnalysis() { leaveJob(); }
  // 回到 landing 后把焦点放到 URL 输入框（结果页点“重新开始”时），
  // 用 effect 而不是 setTimeout 猜渲染时机。
  const wasInResult = useRef(false);
  useEffect(() => {
    if (wasInResult.current && !job) urlInputRef.current?.focus();
    wasInResult.current = Boolean(job);
  }, [job]);
  // 点 Logo 回到首页只离开当前视图；永久任务继续处理并保留。
  function goHome() { leaveJob(); }
  function selectFile(nextFile: File | undefined) { if (!nextFile) return; setFile(nextFile); setError(""); }
  function applyPreset(preset: AnalysisPreset) {
    setInstruction(preset.instruction);
    setOutputSchema(preset.outputSchema === undefined ? "" : JSON.stringify(preset.outputSchema, null, 2));
    setArtifactFormats([...preset.formats]);
    setActivePreset(preset.id);
    setError("");
  }

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><Brand onClick={job ? goHome : undefined} label={t.backHome} /><div className="header-actions">
      <button className="header-button" type="button" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{t.language}</button>
      <button className="header-button" type="button" onClick={() => setShowHistory(true)}><Glyph name="clock" size={16} />{t.history}</button>
      <div className="header-more" ref={moreMenuRef}><button className="header-more-trigger" type="button" aria-label={`${t.admin} / ${t.help}`} aria-expanded={showMoreMenu} aria-controls="header-more-menu" onClick={() => setShowMoreMenu((value) => !value)}><Glyph name="settings" size={17} /></button>{showMoreMenu && <div id="header-more-menu"><a href="/admin"><Glyph name="settings" size={16} />{t.admin}</a><button type="button" onClick={() => { setShowMoreMenu(false); setShowSettings(true); }}><Glyph name="info" size={16} />{t.help}</button></div>}</div>
    </div></div></header>

    <main className="main-shell">
      {!job && <section className="landing-layout">
        <div className="hero-copy">
          <div className="hero-badge"><span />{t.badge}</div>
          <h1>{t.hero}</h1>
          <p>{t.intro}</p>
          <div className="hero-flow" aria-label={`${t.flowVideo}, ${t.flowSignals}, ${t.flowOutput}`}>
            <span>{t.flowVideo}</span><i aria-hidden="true" /><span>{t.flowSignals}</span><i aria-hidden="true" /><strong>{t.flowOutput}</strong>
          </div>
          <div className="hero-character">
            <img className="hero-character-portrait" src="/koma-mascot.png" alt="" />
            <div className="hero-character-copy"><span>FRAME ASSISTANT · 00:00:01</span><strong>{t.mascotCue}</strong><small>{t.mascotCueText}</small></div>
          </div>
        </div>

        <form className="capture-card" onSubmit={startAnalysis} aria-busy={busy} aria-label={t.startOne}>
          <header className="capture-card-head"><div><span>{t.newAnalysis}</span><h2>{t.startOne}</h2></div><img src="/koma-icon-64.png" alt="" /></header>
          <div className="workbench-source">
            <h3 id="video-source-heading" className="workbench-section-label">{t.sourceLabel}</h3>
            <div className="mode-switch" role="group" aria-label={t.sourceLabel}>
              <button className={mode === "upload" ? "selected" : ""} type="button" aria-pressed={mode === "upload"} onClick={() => setMode("upload")}><Glyph name="upload" size={16} />{t.upload}</button>
              <button className={mode === "url" ? "selected" : ""} type="button" aria-pressed={mode === "url"} onClick={() => setMode("url")}><Glyph name="link" size={16} />{t.videoUrl}</button>
            </div>
            {mode === "upload" ? <div ref={dropZoneRef} className={`drop-zone ${file ? "has-file" : ""}`} onClick={() => fileInputRef.current?.click()} onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent) => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]); }} role="button" tabIndex={0} aria-invalid={error === t.missingFile} aria-describedby={error === t.missingFile ? "analysis-form-error" : undefined} onKeyDown={(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }}>
              <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0])} />
              <span className="drop-icon"><Glyph name="upload" size={22} /></span><strong>{file ? file.name : t.drop}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${t.ready}` : fileHint}</small>
            </div> : <label className="url-field"><span><Glyph name="link" size={16} />{t.publicUrl}</span><input ref={urlInputRef} type="text" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t.urlPlaceholder} aria-invalid={error === t.missingUrl} aria-describedby={error === t.missingUrl ? "analysis-form-error" : undefined} /><small>{t.urlHint}</small></label>}
            {sourceError && <p id="analysis-form-error" className="form-error" role="alert">{error}</p>}
          </div>
          <section className="workbench-analysis" aria-labelledby="analysis-mode-heading">
            <h3 id="analysis-mode-heading" className="workbench-section-label">{t.presetsLabel}</h3>
            <p className="workbench-section-hint">{t.presetsHint}</p>
            <div className="preset-panel"><div className="preset-list">{analysisPresets(language).map((preset) => <button key={preset.id} type="button" className={activePreset === preset.id ? "selected" : ""} aria-pressed={activePreset === preset.id} onClick={() => applyPreset(preset)}><span><strong>{preset.label}</strong><small>{preset.description}</small></span><em>{preset.formats.map((format) => format === "markdown" ? "MD" : format.toUpperCase()).join(" + ")}</em></button>)}</div></div>
            <div className={`custom-extraction ${showAdvancedSettings ? "open" : ""} ${hasAdvancedSettings ? "configured" : ""}`}>
              <button ref={advancedTriggerRef} className="custom-extraction-toggle" type="button" aria-haspopup="dialog" aria-expanded={showAdvancedSettings} onClick={() => setShowAdvancedSettings(true)}><span><Glyph name="spark" size={15} /><strong>{t.customExtract}</strong><small>{advancedSummary}</small></span><i aria-hidden="true">→</i></button>
            </div>
          </section>
          <div className="capture-foot"><span><i />{t.temporary}</span><button className="primary-button" type="submit" disabled={busy}>{busy ? (uploadPercent !== null ? `${t.uploading} ${uploadPercent}%` : t.starting) : t.start}<Glyph name="arrow" size={17} /></button></div>
          {uploadPercent !== null && <div className="upload-track" aria-label={`${t.uploadProgress}: ${uploadPercent}%`}><span style={{ width: `${uploadPercent}%` }} /></div>}
          {error && !sourceError && <p id="analysis-form-error" className="form-error" role="alert">{error}</p>}
        </form>
      </section>}
      {job && !hasResult && <ProgressView job={job} progress={progress} error={error} onClear={leaveJob} onRetry={retryAnalysis} language={language} />}
      {hasResult && <ResultView job={job} onRestart={restartAnalysis} onDelete={deleteOwnedJob} language={language} />}
    </main>
    {showAdvancedSettings && <AdvancedSettingsDialog language={language} instruction={instruction} outputSchema={outputSchema} artifactFormats={artifactFormats} returnFocusRef={advancedTriggerRef} onCancel={() => setShowAdvancedSettings(false)} onApply={(next) => {
      const formatsChanged = next.artifactFormats.length !== artifactFormats.length || next.artifactFormats.some((format, index) => format !== artifactFormats[index]);
      const changed = next.instruction !== instruction || next.outputSchema !== outputSchema || formatsChanged;
      setInstruction(next.instruction);
      setOutputSchema(next.outputSchema);
      setArtifactFormats(next.artifactFormats);
      if (changed) setActivePreset(null);
      setShowAdvancedSettings(false);
      setError("");
    }} />}
    {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onOpen={openHistoryJob} onDelete={deleteOwnedJob} language={language} />}
    {showSettings && <InfoModal onClose={() => setShowSettings(false)} language={language} />}
  </div>;
}

function ProgressView({ job, progress, error, onClear, onRetry, language }: { job: Job; progress: number; error: string; onClear: () => void; onRetry: () => void; language: Language }) {
  const t = copy[language];
  const failed = job.status === "failed";
  const safeProgress = Math.min(100, Math.max(0, progress));
  const stageLabel = job.progress ? t.stage[job.progress.stage] || t.processing : t.processing;
  const steps = progressStepStates(job.progress?.stage || "queued", job.status, safeProgress);
  return <section className="progress-layout"><div className="progress-copy"><span className="page-label">{job.source === "url" ? t.analyzingRemote : t.analyzingLocal}</span><h1>{t.progressTitle}</h1><p>{t.progressText}</p></div>
    <div className={`progress-card ${failed ? "failed" : ""}`}><div className="progress-mascot"><img src="/koma-mascot.png" alt="" /></div><div className="progress-status"><span aria-live="polite" aria-atomic="true">{stageLabel}</span><strong aria-hidden={failed}>{failed ? "!" : `${safeProgress}%`}</strong></div>{!failed && <div className="progress-track" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={safeProgress}><span style={{ width: `${safeProgress}%` }} /></div>}<p>{job.progress?.detail || t.preparing}</p>{(error || job.error) && <div className="inline-error" role="alert">{translateServerError(error || job.error, language)}</div>}<div className="process-list"><span className={steps[0]} aria-current={steps[0] === "current" ? "step" : undefined}>{t.entered}</span><span className={steps[1]} aria-current={steps[1] === "current" ? "step" : undefined}>{t.mediaAnalysis}</span><span className={steps[2]} aria-current={steps[2] === "current" ? "step" : undefined}>{t.readableResult}</span></div>{failed ? <div className="retry-row"><button className="primary-button" type="button" onClick={onRetry}>{t.retry}<Glyph name="arrow" size={17} /></button><button className="text-button" type="button" onClick={onClear}>{t.cancel}</button></div> : <button className="text-button" type="button" onClick={onClear}>{t.cancel}</button>}</div>
  </section>;
}

function FitTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { const element = ref.current; if (!element) return undefined; const fit = () => { const base = Number.parseFloat(getComputedStyle(element).fontSize) || 43; element.style.fontSize = ""; let size = base; while (size > 24 && element.scrollWidth > element.clientWidth) { size -= 1; element.style.fontSize = `${size}px`; } }; fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }, [children]);
  return <h1 ref={ref}>{children}</h1>;
}

function ResultView({ job, onRestart, onDelete, language }: { job: Job; onRestart: () => void; onDelete: (id: string) => Promise<boolean>; language: Language }) {
  const t = copy[language]; const result = job.result as AnalysisResult;
  const [selectedFrame, setSelectedFrame] = useState(0); const [currentMs, setCurrentMs] = useState(0); const [showSubtitles, setShowSubtitles] = useState(false); const [linkCopied, setLinkCopied] = useState(false); const [deleting, setDeleting] = useState(false); const videoRef = useRef<HTMLVideoElement>(null);
  // 结果页让浏览器标签页显示视频标题
  useEffect(() => {
    const previous = document.title;
    document.title = result.title || (language === "zh" ? "Koma — AI 视频理解" : "Koma — AI Video Understanding");
    return () => { document.title = previous; };
  }, [result.title, language]);
  const selected = result.frames[selectedFrame] || result.frames[0];
  const [previewFrame, setPreviewFrame] = useState<Frame | null>(null);
  useEffect(() => { setShowSubtitles(!result.hasSubtitles); }, [result.hasSubtitles]);
  const activeSubtitle = showSubtitles ? (result.transcript || []).find((line) => currentMs >= line.startMs && currentMs < line.endMs) : null;
  async function copyReplayLink() { await navigator.clipboard.writeText(window.location.href); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 1600); }
  async function deleteResult() {
    setDeleting(true);
    try { await onDelete(job.id); }
    catch (cause) { window.alert(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); }
    finally { setDeleting(false); }
  }
  function syncToTime(atMs: number, shouldPlay = true) { const targetMs = Math.min(result.durationMs || atMs, Math.max(0, Number(atMs) || 0)); const video = videoRef.current; const seek = () => { const element = videoRef.current; if (!element) return; element.currentTime = targetMs / 1000; if (shouldPlay) element.play().catch(() => undefined); }; if (video) { if (video.readyState >= 1) seek(); else video.addEventListener("loadedmetadata", seek, { once: true }); } setCurrentMs(targetMs); setSelectedFrame(frameIndexAtTime(result.frames, targetMs)); }
  function followPlayback() { const nextMs = Math.round((videoRef.current?.currentTime || 0) * 1000); setCurrentMs(nextMs); setSelectedFrame(frameIndexAtTime(result.frames, nextMs)); }

  return <section className="result-layout"><div className="result-main">
    <div className="result-heading"><div className="result-title"><span className="page-label">{t.completed} · {formatDate(job.createdAt, language)}</span><FitTitle>{result.title || t.resultFallback}</FitTitle></div><div className="result-actions"><button className="restart-button" type="button" onClick={onRestart}><Glyph name="arrow" size={15} />{t.restart}</button><button className="clear-button" type="button" onClick={() => void copyReplayLink()}><Glyph name="link" size={16} />{linkCopied ? t.linkCopied : t.clear}</button>{job.owned && <button className="result-delete-button" type="button" disabled={deleting} onClick={() => void deleteResult()}><Glyph name="trash" size={16} />{deleting ? t.deleting : t.deleteOwn}</button>}</div></div>
    <div className="summary-block"><span><Glyph name="spark" size={15} />{t.aiSummary}</span><p>{result.summary}</p></div>
    {Object.prototype.hasOwnProperty.call(result, "extractedData") && <StructuredData data={result.extractedData} jobId={job.id} language={language} />}
    {result.artifacts?.length ? <ArtifactPanel artifacts={result.artifacts} language={language} /> : null}
    <div className="stat-row"><div><span>{t.duration}</span><strong>{formatTime(result.durationMs)}</strong></div><div><span>{t.frames}</span><strong>{result.frames.length}</strong></div><div><span>{t.subtitleLines}</span><strong>{result.transcript.length}</strong></div><div><span>{t.autoDelete}</span><strong className="persistent-status">{t.replayReady}</strong></div></div>
    <section className="tag-panel"><div className="section-heading"><span>{t.contentTags}</span><small>{t.jumpTag}</small></div><div className="tag-list">{(result.tags || []).map((tag) => <button type="button" className="tag-chip" key={`${tag.category}-${tag.label}`} onClick={() => syncToTime(tag.atMs)}><span>{tag.category}</span>{tag.label}<i>{formatTime(tag.atMs)}</i></button>)}</div></section>
    <div className="video-stage"><div className="video-stage-player"><video ref={videoRef} src={result.videoUrl} poster={result.frames[0]?.url} controls playsInline preload="metadata" onTimeUpdate={followPlayback} onSeeked={followPlayback}>{t.browserNoVideo}</video>{activeSubtitle && <div className="video-subtitle">{activeSubtitle.speaker != null && String(activeSubtitle.speaker).trim() ? <span>{t.speaker} {activeSubtitle.speaker}</span> : null}<p>{activeSubtitle.text}</p></div>}<button type="button" className={`cc-toggle ${showSubtitles ? "on" : ""}`} aria-pressed={showSubtitles} onClick={() => setShowSubtitles((value) => !value)} title={showSubtitles ? t.subtitlesOn : t.subtitlesOff}><Glyph name="cc" size={13} />{t.subtitlesToggle}</button></div><div className="video-stage-caption"><span>{selected?.caption || t.reviewing}</span><span>{formatTime(currentMs)} / {formatTime(result.durationMs)}</span></div></div>
    <section className="keyframe-panel" aria-label={t.frameTimeline}><div className="section-heading"><span>{t.keyFrameGallery}</span><small>{t.keyFrameGallerySub}</small></div><div className="frame-gallery">{result.frames.map((frame, index) => <button key={frame.url} type="button" aria-label={`${t.jumpTo} ${formatTime(frame.atMs)}: ${frame.caption || t.keyFrame}`} className={index === selectedFrame ? "active" : ""} onClick={() => { syncToTime(frame.atMs, false); setPreviewFrame(frame); }}><span className="frame-gallery-image"><img src={frame.url} alt={frame.caption || t.keyFrame} /><i>{formatTime(frame.atMs)}</i><em><Glyph name="zoom" size={14} />{t.clickToEnlarge}</em></span><strong>{frame.caption || `${t.keyFrame} ${index + 1}`}</strong></button>)}</div></section>
    <section className="chapters"><div className="section-heading"><span>{t.chapters}</span><small>{result.chapters.length ? `${result.chapters.length} ${t.chaptersCount} · ${t.chaptersSub}` : ""}</small></div>{result.chapters.length ? <div className="chapter-list">{(result.chapters || []).map((chapter, index) => <button type="button" className="chapter" key={`${chapter.startMs}-${index}`} onClick={() => syncToTime(chapter.startMs)}><span className="chapter-rail"><strong>{index + 1}</strong><i>{formatTime(chapter.startMs)} – {formatTime(chapter.endMs)}</i></span><span className="chapter-body"><strong>{chapter.title}</strong><p>{chapter.summary}</p></span><Glyph name="arrow" size={18} /></button>)}</div> : <div className="chapter-empty">{t.noChapters}</div>}</section>
  </div>
  <aside className="transcript-panel"><div className="panel-heading"><div><span className="page-label">SUBTITLES</span><h2>{t.subtitlePanel}</h2><p>{t.subtitlePanelText}</p></div><span className="live-dot" /></div><div className="transcript-list">{result.transcript.length ? result.transcript.map((line, index) => { const active = currentMs >= line.startMs && currentMs < line.endMs; const speaker = line.speaker != null && String(line.speaker).trim() ? `${t.speaker} ${line.speaker}` : t.voice; return <button type="button" className={`transcript-line ${active ? "active" : ""}`} aria-pressed={active} key={`${line.startMs}-${index}`} onClick={() => syncToTime(line.startMs)}><span className="line-rail"><strong>{formatTime(line.startMs)}</strong><i>{formatTime(line.endMs)}</i></span><span className="line-body"><small><i />{speaker}</small><p>{line.text}</p><em><Glyph name="play" size={11} />{t.playFrom} {formatTime(line.startMs)}</em></span></button>; }) : <div className="transcript-empty">{t.noSpeech}</div>}</div><div className="panel-note"><Glyph name="link" size={14} />{t.remaining}</div></aside>
  {previewFrame && <FramePreview frame={previewFrame} onClose={() => setPreviewFrame(null)} onPlay={() => { syncToTime(previewFrame.atMs); setPreviewFrame(null); }} onPrevious={() => { const index = result.frames.findIndex((frame) => frame.url === previewFrame.url); setPreviewFrame(result.frames[(index - 1 + result.frames.length) % result.frames.length]); }} onNext={() => { const index = result.frames.findIndex((frame) => frame.url === previewFrame.url); setPreviewFrame(result.frames[(index + 1) % result.frames.length]); }} language={language} />}
  </section>;
}

function StructuredData({ data, jobId, language }: { data: unknown; jobId: string; language: Language }) {
  const t = copy[language];
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(data, null, 2) ?? "null";
  async function copyJson() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  function downloadJson() {
    const blob = new Blob([`${json}\n`], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `koma-${jobId}-extraction.json`;
    link.click();
    URL.revokeObjectURL(href);
  }
  return <section className="structured-panel">
    <div className="section-heading"><span>{t.structuredData}</span><small>{t.structuredDataSub}</small></div>
    <pre>{json}</pre>
    <div className="structured-actions"><button type="button" onClick={copyJson}>{copied ? t.copied : t.copyJson}</button><button type="button" onClick={downloadJson}>{t.downloadJson}</button><a href={`/api/jobs/${jobId}/extraction`} target="_blank" rel="noreferrer">API</a></div>
  </section>;
}

function ArtifactPanel({ artifacts, language }: { artifacts: Artifact[]; language: Language }) {
  const t = copy[language];
  return <section className="artifact-panel">
    <div className="section-heading"><span>{t.generatedFiles}</span><small>{t.generatedFilesSub}</small></div>
    <div className="artifact-list">{artifacts.map((artifact) => <a key={artifact.id} href={artifact.downloadUrl} download={artifact.name}><span><strong>{artifact.name}</strong><small>{artifact.format.toUpperCase()}{artifact.language ? ` · ${artifact.language}` : ""} · {formatBytes(artifact.sizeBytes)}</small></span><em>{t.downloadFile}<Glyph name="arrow" size={14} /></em></a>)}</div>
  </section>;
}

function FramePreview({ frame, onClose, onPlay, onPrevious, onNext, language }: { frame: Frame; onClose: () => void; onPlay: () => void; onPrevious: () => void; onNext: () => void; language: Language }) {
  const t = copy[language];
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const onPreviousRef = useRef(onPrevious);
  const onNextRef = useRef(onNext);
  onCloseRef.current = onClose;
  onPreviousRef.current = onPrevious;
  onNextRef.current = onNext;
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); if (event.key === "ArrowLeft") onPreviousRef.current(); if (event.key === "ArrowRight") onNextRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="frame-preview" role="dialog" aria-modal="true" aria-label={t.framePreview} onClick={(event) => event.stopPropagation()}>
    <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label={t.close}>×</button>
    <div className="frame-preview-image"><img src={frame.url} alt={frame.caption || t.keyFrame} /><button className="frame-nav previous" type="button" onClick={onPrevious} aria-label={t.previousFrame}>‹</button><button className="frame-nav next" type="button" onClick={onNext} aria-label={t.nextFrame}>›</button></div>
    <div className="frame-preview-body"><span className="page-label">{t.framePreview} · {formatTime(frame.atMs)}</span><p>{frame.caption || t.keyFrame}</p><div className="frame-preview-actions"><a href={frame.url} target="_blank" rel="noreferrer">{t.openOriginal}</a><button className="primary-button" type="button" onClick={onPlay}><Glyph name="play" size={15} />{t.playThisMoment}</button></div></div>
  </div></div>;
}

function frameIndexAtTime(frames: Frame[], atMs: number): number { let nearest = 0; for (let index = 0; index < frames.length; index += 1) { if (frames[index].atMs > atMs) break; nearest = index; } return nearest; }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AdvancedSettingsValue {
  instruction: string;
  outputSchema: string;
  artifactFormats: ArtifactFormat[];
}

function AdvancedSettingsDialog({ language, instruction, outputSchema, artifactFormats, returnFocusRef, onCancel, onApply }: {
  language: Language;
  instruction: string;
  outputSchema: string;
  artifactFormats: ArtifactFormat[];
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onApply: (value: AdvancedSettingsValue) => void;
}) {
  const t = copy[language];
  const [draftInstruction, setDraftInstruction] = useState(instruction);
  const [draftSchema, setDraftSchema] = useState(outputSchema);
  const [draftFormats, setDraftFormats] = useState<ArtifactFormat[]>([...artifactFormats]);
  const [dialogError, setDialogError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const schemaRef = useRef<HTMLTextAreaElement>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const root = document.documentElement;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousRootOverflow = root.style.overflow;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        titleRef.current?.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    dialog.showModal();
    dialog.addEventListener("keydown", keepFocusInside, true);
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      dialog.removeEventListener("keydown", keepFocusInside, true);
      if (dialog.open) dialog.close();
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousOverflow;
      window.scrollTo(scrollX, scrollY);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [returnFocusRef]);

  function toggleDraftFormat(format: ArtifactFormat) {
    setDraftFormats((current) => current.includes(format) ? current.filter((item) => item !== format) : [...current, format]);
  }

  function applySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      parseOutputSchema(draftSchema, t.invalidSchema);
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : t.invalidSchema);
      schemaRef.current?.focus();
      return;
    }
    onApply({ instruction: draftInstruction, outputSchema: draftSchema, artifactFormats: [...draftFormats] });
  }

  return <dialog ref={dialogRef} className="advanced-dialog" aria-modal="true" aria-labelledby="advanced-dialog-title" aria-describedby="advanced-dialog-description" onCancel={(event) => { event.preventDefault(); onCancelRef.current(); }} onClick={(event) => { if (event.target === event.currentTarget) onCancelRef.current(); }}>
    <form className="advanced-dialog-shell" onSubmit={applySettings}>
      <header className="advanced-dialog-head">
        <div><span className="page-label">KOMA OPTIONS</span><h2 ref={titleRef} id="advanced-dialog-title" tabIndex={-1}>{t.customExtract}</h2><p id="advanced-dialog-description">{t.advancedDescription}</p></div>
        <button className="advanced-dialog-close" type="button" onClick={onCancel} aria-label={t.close}>×</button>
      </header>
      <div className="advanced-dialog-body custom-extraction-fields">
        <label><span>{t.analysisRequirement}</span><textarea value={draftInstruction} onChange={(event) => setDraftInstruction(event.target.value)} maxLength={4000} rows={4} placeholder={t.instructionPlaceholder} /></label>
        <label><span>{t.outputShape}</span><textarea ref={schemaRef} className="schema-input" value={draftSchema} onChange={(event) => { setDraftSchema(event.target.value); setDialogError(""); }} maxLength={12000} rows={8} spellCheck={false} placeholder={t.schemaPlaceholder} aria-invalid={Boolean(dialogError)} aria-describedby={dialogError ? "advanced-schema-error" : "advanced-schema-hint"} /><small id="advanced-schema-hint">{t.schemaHint}</small>{dialogError && <small id="advanced-schema-error" className="advanced-dialog-error" role="alert">{dialogError}</small>}</label>
        <fieldset className="artifact-format-field"><legend>{t.outputFiles}</legend><small>{t.outputFilesHint}</small><div className="artifact-format-list">{(["json", "csv", "markdown", "srt", "text"] as ArtifactFormat[]).map((format) => <button key={format} type="button" className={draftFormats.includes(format) ? "selected" : ""} aria-pressed={draftFormats.includes(format)} onClick={() => toggleDraftFormat(format)}>{format === "markdown" ? "Markdown" : format.toUpperCase()}</button>)}</div></fieldset>
      </div>
      <footer className="advanced-dialog-foot"><button className="advanced-dialog-cancel" type="button" onClick={onCancel}>{t.cancelSettings}</button><button className="primary-button" type="submit">{t.applySettings}<Glyph name="arrow" size={17} /></button></footer>
    </form>
  </dialog>;
}

function HistoryModal({ onClose, onOpen, onDelete, language }: { onClose: () => void; onOpen: (id: string) => Promise<void>; onDelete: (id: string) => Promise<boolean>; language: Language }) {
  const t = copy[language];
  const [jobs, setJobs] = useState<JobHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const controller = new AbortController();
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    fetch("/api/my/jobs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { jobs?: JobHistoryItem[]; error?: string };
        if (!response.ok) throw new Error(body.error || t.startFailed);
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); window.removeEventListener("keydown", onKeyDown); };
  }, [language, t.startFailed]);

  async function removeJob(id: string) {
    setDeletingId(id); setError("");
    try {
      if (await onDelete(id)) setJobs((current) => current.filter((job) => job.id !== id));
    } catch (cause) {
      setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language));
    } finally { setDeletingId(null); }
  }

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}>
    <button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label={t.close}>×</button>
    <div className="history-modal-head"><span className="page-label">KOMA HISTORY</span><h2 id="history-title">{t.historyTitle}</h2><p>{t.historyText}</p></div>
    <div className="history-list">
      {loading && <div className="history-empty">{t.historyLoading}</div>}
      {!loading && !jobs.length && !error && <div className="history-empty"><Glyph name="clock" size={22} /><span>{t.historyEmpty}</span></div>}
      {jobs.map((item) => <article className="history-item" key={item.id}>
        <button className="history-item-main" type="button" onClick={() => void onOpen(item.id)}>
          <span className={`history-status ${item.status}`}><i />{t.stage[item.progress.stage] || item.status}</span>
          <strong>{item.title}</strong>
          <small>{formatDate(item.createdAt, language)} · {item.source === "upload" ? t.upload : t.videoUrl}</small>
          {item.status !== "done" && <span className="history-progress"><i style={{ width: `${Math.min(100, Math.max(0, item.progress.percent))}%` }} /></span>}
        </button>
        <div className="history-item-actions"><button type="button" onClick={() => void onOpen(item.id)}>{t.openResult}<Glyph name="arrow" size={14} /></button><button className="history-delete" type="button" disabled={deletingId === item.id} onClick={() => void removeJob(item.id)}><Glyph name="trash" size={14} />{deletingId === item.id ? t.deleting : t.deleteOwn}</button></div>
      </article>)}
    </div>
    {error && <p className="form-error history-error" role="alert">{error}</p>}
  </div></div>;
}

function InfoModal({ onClose, language }: { onClose: () => void; language: Language }) {
  const t = copy[language];
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose 是父组件内联箭头函数，每次渲染引用都会变；
  // 用 ref 存最新值，effect 只在挂载时跑一次（聚焦 + 监听 Escape），
  // 避免父组件重渲染时焦点被反复抢回关闭按钮。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="info-modal" role="dialog" aria-modal="true" aria-labelledby="info-title" onClick={(event) => event.stopPropagation()}><button ref={closeRef} className="modal-close" type="button" onClick={onClose} aria-label={t.close}>×</button><div className="info-modal-head"><img src="/koma-icon-64.png" alt="" /><div><span className="page-label">KOMA GUIDE</span><h2 id="info-title">{t.aboutTitle}</h2><p>{t.aboutText}</p></div></div><div className="help-steps">{t.aboutSteps.map((step) => <section key={step.title}><strong>{step.title}</strong><p>{step.text}</p></section>)}</div><p className="modal-muted">{t.aboutMuted}</p><button className="primary-button" type="button" onClick={onClose}>{t.gotIt}<Glyph name="arrow" size={17} /></button></div></div>;
}

export default App;
