export interface SearchableJob {
  title: string;
  summary?: string;
  status: string;
  error?: string | null;
}

export function filterJobs<T extends SearchableJob>(jobs: readonly T[], query: string, status: string): T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((job) => (status === "all" || (status === "active" ? job.status === "queued" || job.status === "processing" : job.status === status))
    && words.every((word) => `${job.title} ${job.summary || ""} ${job.error || ""}`.toLocaleLowerCase().includes(word)));
}

export interface ExportTranscriptLine { startMs: number; endMs: number; text: string; speaker?: string; }
export interface ExportResult {
  title: string;
  summary: string;
  durationMs: number;
  chapters: { startMs: number; title: string; summary: string }[];
  transcript: ExportTranscriptLine[];
  extractedData?: unknown;
}

function timestamp(ms: number, srt = false): string {
  const safeMs = Math.max(0, Math.round(Number.isFinite(ms) ? ms : 0));
  const seconds = Math.floor(safeMs / 1000);
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}${srt ? `,${String(safeMs % 1000).padStart(3, "0")}` : ""}`;
}

/** Produce portable SRT without changing the original transcript or its timing. */
export function transcriptToSrt(lines: readonly ExportTranscriptLine[]): string {
  return lines.filter((line) => line.text.trim()).map((line, index) => {
    const startMs = Math.max(0, line.startMs);
    const endMs = Math.max(startMs + 1, line.endMs);
    const text = line.text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n").trim();
    return `${index + 1}\n${timestamp(startMs, true)} --> ${timestamp(endMs, true)}\n${text}`;
  }).join("\n\n") + (lines.some((line) => line.text.trim()) ? "\n" : "");
}

export function resultToMarkdown(result: ExportResult, language: "en" | "zh"): string {
  const labels = language === "zh" ? ["摘要", "章节", "字幕", "提取的数据"] : ["Summary", "Chapters", "Transcript", "Extracted data"];
  const sections = [`# ${result.title.replace(/[\r\n]+/g, " ") || "Koma"}`, `## ${labels[0]}\n\n${result.summary}`];
  if (result.chapters.length) sections.push(`## ${labels[1]}\n\n${result.chapters.map((chapter) => `### ${timestamp(chapter.startMs)} · ${chapter.title.replace(/[\r\n]+/g, " ")}\n\n${chapter.summary}`).join("\n\n")}`);
  if (result.transcript.length) sections.push(`## ${labels[2]}\n\n${result.transcript.map((line) => `**${timestamp(line.startMs)}${line.speaker ? ` · ${line.speaker}` : ""}** ${line.text}`).join("\n\n")}`);
  if (Object.prototype.hasOwnProperty.call(result, "extractedData")) {
    const json = JSON.stringify(result.extractedData, null, 2) ?? "null";
    // A dynamic fence keeps model-generated backticks from ending the JSON block.
    const fence = "`".repeat(Math.max(3, ...Array.from(json.matchAll(/`+/g), (match) => match[0].length + 1)));
    sections.push(`## ${labels[3]}\n\n${fence}json\n${json}\n${fence}`);
  }
  return sections.join("\n\n") + "\n";
}

export function downloadText(text: string, filename: string, mimeType: string): void {
  const href = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function transcriptMatches(lines: readonly ExportTranscriptLine[], query: string): number[] {
  const normalized = query.trim().toLocaleLowerCase();
  return normalized ? lines.flatMap((line, index) => line.text.toLocaleLowerCase().includes(normalized) ? [index] : []) : [];
}
