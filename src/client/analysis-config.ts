import {
  MAX_ANALYSIS_INSTRUCTION_CHARS,
  MAX_OUTPUT_SCHEMA_CHARS
} from "../server/analysis-spec.js";

export { MAX_ANALYSIS_INSTRUCTION_CHARS, MAX_OUTPUT_SCHEMA_CHARS };

export const ANALYSIS_CONFIG_STORAGE_KEY = "koma-analysis-config";
export const ANALYSIS_CONFIG_VERSION = 1 as const;
export const ANALYSIS_SUGGESTION_IDS = ["extract", "subtitles", "report"] as const;
export type AnalysisSuggestionId = typeof ANALYSIS_SUGGESTION_IDS[number];
export type AnalysisFieldSource = "request" | "addition";

export interface AnalysisFieldDescription {
  path: string;
  label: string;
  description: string;
  source: AnalysisFieldSource;
}

export interface AnalysisDraft {
  instruction: string;
  suggestionIds: string[];
  outputSchema: string;
  outputSchemaRequestKey?: string;
  fieldDescriptions?: AnalysisFieldDescription[];
}

export interface StoredAnalysisConfig {
  version: 1;
  draft: AnalysisDraft;
  defaultConfig?: AnalysisDraft;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const allowedSuggestionIds = new Set<string>(ANALYSIS_SUGGESTION_IDS);

/** Build a stable identity for the request that an output schema was confirmed against. */
export function analysisRequestKey(instruction: string, suggestionIds: readonly string[]): string {
  const normalizedSuggestionIds = [...new Set(
    suggestionIds.filter((candidate) => allowedSuggestionIds.has(candidate))
  )].sort();
  return JSON.stringify([instruction.trim(), normalizedSuggestionIds]);
}

export function createEmptyAnalysisDraft(): AnalysisDraft {
  return { instruction: "", suggestionIds: [], outputSchema: "" };
}

export function loadAnalysisConfig(storage: StorageLike): StoredAnalysisConfig {
  try {
    const raw = storage.getItem(ANALYSIS_CONFIG_STORAGE_KEY);
    if (!raw) return emptyStoredConfig();
    return normalizeStoredConfig(JSON.parse(raw) as unknown);
  } catch {
    return emptyStoredConfig();
  }
}

/**
 * Persist a sanitized copy. The return value only reports whether browser
 * storage accepted the write; storage errors never escape into the UI.
 */
export function saveAnalysisConfig(storage: StorageLike, value: StoredAnalysisConfig): boolean {
  const normalized = normalizeStoredConfig(value);
  try {
    storage.setItem(ANALYSIS_CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

/** Update the local draft while retaining any reusable default. */
export function updateAnalysisDraft(storage: StorageLike, draft: AnalysisDraft): StoredAnalysisConfig {
  const current = loadAnalysisConfig(storage);
  const next: StoredAnalysisConfig = {
    version: ANALYSIS_CONFIG_VERSION,
    draft: normalizeDraft(draft) ?? createEmptyAnalysisDraft(),
    ...(current.defaultConfig ? { defaultConfig: cloneDraft(current.defaultConfig) } : {})
  };
  saveAnalysisConfig(storage, next);
  return next;
}

/** Save the supplied draft, or the active draft, as the browser default. */
export function saveAnalysisDefault(storage: StorageLike, draft?: AnalysisDraft): StoredAnalysisConfig {
  const current = loadAnalysisConfig(storage);
  const defaultConfig = draft === undefined
    ? cloneDraft(current.draft)
    : normalizeDraft(draft) ?? createEmptyAnalysisDraft();
  const next: StoredAnalysisConfig = {
    version: ANALYSIS_CONFIG_VERSION,
    draft: cloneDraft(current.draft),
    defaultConfig
  };
  saveAnalysisConfig(storage, next);
  return next;
}

/** Restore the reusable default into the active draft, if one exists. */
export function restoreAnalysisDefault(storage: StorageLike): StoredAnalysisConfig {
  const current = loadAnalysisConfig(storage);
  if (!current.defaultConfig) return current;
  const next: StoredAnalysisConfig = {
    version: ANALYSIS_CONFIG_VERSION,
    draft: cloneDraft(current.defaultConfig),
    defaultConfig: cloneDraft(current.defaultConfig)
  };
  saveAnalysisConfig(storage, next);
  return next;
}

function normalizeStoredConfig(value: unknown): StoredAnalysisConfig {
  if (!isRecord(value) || value.version !== ANALYSIS_CONFIG_VERSION) return emptyStoredConfig();
  const draft = normalizeDraft(value.draft);
  if (!draft) return emptyStoredConfig();
  const defaultConfig = value.defaultConfig === undefined ? undefined : normalizeDraft(value.defaultConfig);
  return {
    version: ANALYSIS_CONFIG_VERSION,
    draft,
    ...(defaultConfig ? { defaultConfig } : {})
  };
}

function normalizeDraft(value: unknown): AnalysisDraft | undefined {
  if (!isRecord(value)
    || typeof value.instruction !== "string"
    || !Array.isArray(value.suggestionIds)
    || typeof value.outputSchema !== "string") {
    return undefined;
  }
  const suggestionIds: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value.suggestionIds) {
    if (typeof candidate !== "string" || !allowedSuggestionIds.has(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    suggestionIds.push(candidate);
  }
  const outputSchema = value.outputSchema.slice(0, MAX_OUTPUT_SCHEMA_CHARS);
  const outputSchemaRequestKey = outputSchema.trim()
    ? normalizeAnalysisRequestKey(value.outputSchemaRequestKey)
    : undefined;
  const fieldDescriptions = normalizeFieldDescriptions(value.fieldDescriptions);
  return {
    instruction: value.instruction.slice(0, MAX_ANALYSIS_INSTRUCTION_CHARS),
    suggestionIds,
    outputSchema,
    ...(outputSchemaRequestKey ? { outputSchemaRequestKey } : {}),
    ...(fieldDescriptions.length ? { fieldDescriptions } : {})
  };
}

function cloneDraft(value: AnalysisDraft): AnalysisDraft {
  return {
    instruction: value.instruction,
    suggestionIds: [...value.suggestionIds],
    outputSchema: value.outputSchema,
    ...(value.outputSchema.trim() && value.outputSchemaRequestKey
      ? { outputSchemaRequestKey: value.outputSchemaRequestKey }
      : {}),
    ...(value.fieldDescriptions ? { fieldDescriptions: value.fieldDescriptions.map((field) => ({ ...field })) } : {})
  };
}

function normalizeAnalysisRequestKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)
      || parsed.length !== 2
      || typeof parsed[0] !== "string"
      || parsed[0].length > MAX_ANALYSIS_INSTRUCTION_CHARS
      || !Array.isArray(parsed[1])
      || parsed[1].some((candidate) => typeof candidate !== "string")) return undefined;
    const normalized = analysisRequestKey(parsed[0], parsed[1]);
    return normalized === value ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function normalizeFieldDescriptions(value: unknown): AnalysisFieldDescription[] {
  if (!Array.isArray(value)) return [];
  const descriptions: AnalysisFieldDescription[] = [];
  const seenPaths = new Set<string>();
  for (const candidate of value.slice(0, 64)) {
    if (!isRecord(candidate)
      || typeof candidate.path !== "string"
      || typeof candidate.label !== "string"
      || typeof candidate.description !== "string"
      || (candidate.source !== "request" && candidate.source !== "addition")) continue;
    const path = candidate.path.trim().slice(0, 300);
    const label = candidate.label.trim().slice(0, 80);
    const description = candidate.description.trim().slice(0, 300);
    if (!path || !label || !description || seenPaths.has(path)) continue;
    seenPaths.add(path);
    descriptions.push({ path, label, description, source: candidate.source });
  }
  return descriptions;
}

function emptyStoredConfig(): StoredAnalysisConfig {
  return { version: ANALYSIS_CONFIG_VERSION, draft: createEmptyAnalysisDraft() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
