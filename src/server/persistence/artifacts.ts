import { ARTIFACT_FORMATS, type ArtifactFormat } from "../analysis/analysis-spec.js";

export const MAX_ARTIFACTS = 8;
export const MAX_ARTIFACT_CHARS = 200_000;
export const MAX_ARTIFACT_TOTAL_CHARS = 500_000;

export interface Artifact {
  id: string;
  name: string;
  format: ArtifactFormat;
  mimeType: string;
  language?: string;
  content: string;
  sizeBytes: number;
}

const FORMAT_INFO: Record<ArtifactFormat, { extension: string; mimeType: string }> = {
  json: { extension: ".json", mimeType: "application/json; charset=utf-8" },
  csv: { extension: ".csv", mimeType: "text/csv; charset=utf-8" },
  markdown: { extension: ".md", mimeType: "text/markdown; charset=utf-8" },
  srt: { extension: ".srt", mimeType: "application/x-subrip; charset=utf-8" },
  text: { extension: ".txt", mimeType: "text/plain; charset=utf-8" }
};

export function normalizeArtifacts(raw: unknown): Artifact[] {
  if (!Array.isArray(raw)) return [];
  const artifacts: Artifact[] = [];
  let totalChars = 0;
  for (const item of raw.slice(0, MAX_ARTIFACTS)) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    const format = normalizeFormat(candidate.format, candidate.name, candidate.mimeType);
    if (!format) continue;
    const content = normalizeContent(candidate.content, format);
    if (!content.trim()) continue;
    if (content.length > MAX_ARTIFACT_CHARS) throw new Error(`产物文件超过 ${MAX_ARTIFACT_CHARS} 个字符，请缩小输出范围。`);
    totalChars += content.length;
    if (totalChars > MAX_ARTIFACT_TOTAL_CHARS) throw new Error(`产物文件总量超过 ${MAX_ARTIFACT_TOTAL_CHARS} 个字符，请减少文件数量或内容。`);
    const name = normalizeFilename(candidate.name, format, artifacts.length);
    const language = cleanLanguage(candidate.language);
    artifacts.push({
      id: String(artifacts.length),
      name,
      format,
      mimeType: FORMAT_INFO[format].mimeType,
      ...(language ? { language } : {}),
      content,
      sizeBytes: Buffer.byteLength(content, "utf8")
    });
  }
  return artifacts;
}

export function missingArtifactFormats(artifacts: Artifact[], requested: ArtifactFormat[]): ArtifactFormat[] {
  const present = new Set(artifacts.map((artifact) => artifact.format));
  return requested.filter((format) => !present.has(format));
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "koma-output.txt";
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function normalizeFormat(formatValue: unknown, nameValue: unknown, mimeValue: unknown): ArtifactFormat | null {
  const direct = String(formatValue || "").trim().toLowerCase();
  if (ARTIFACT_FORMATS.includes(direct as ArtifactFormat)) return direct as ArtifactFormat;
  const filename = String(nameValue || "").toLowerCase();
  if (filename.endsWith(".json")) return "json";
  if (filename.endsWith(".csv")) return "csv";
  if (filename.endsWith(".md") || filename.endsWith(".markdown")) return "markdown";
  if (filename.endsWith(".srt")) return "srt";
  if (filename.endsWith(".txt")) return "text";
  const mime = String(mimeValue || "").toLowerCase();
  if (mime.includes("json")) return "json";
  if (mime.includes("csv")) return "csv";
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("subrip")) return "srt";
  if (mime.startsWith("text/")) return "text";
  return null;
}

function normalizeContent(value: unknown, format: ArtifactFormat): string {
  if (format === "json" && typeof value !== "string") return JSON.stringify(value ?? null, null, 2);
  const content = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2);
  if (format === "json") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      throw new Error("模型返回的 JSON 产物不是有效 JSON，请重试。");
    }
  }
  return content;
}

function normalizeFilename(value: unknown, format: ArtifactFormat, index: number): string {
  const info = FORMAT_INFO[format];
  const raw = typeof value === "string" ? value.trim() : "";
  const leaf = raw.split(/[\\/]/).pop() || `koma-output-${index + 1}${info.extension}`;
  const safe = leaf
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 96)
    .trim();
  const base = safe || `koma-output-${index + 1}`;
  return base.toLowerCase().endsWith(info.extension) ? base : `${base}${info.extension}`;
}

function cleanLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const language = value.trim().slice(0, 40);
  return language || undefined;
}
