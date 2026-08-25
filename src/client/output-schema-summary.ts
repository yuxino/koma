import type { AnalysisFieldDescription, AnalysisFieldSource } from "./analysis-config.js";

export type OutputSchemaLanguage = "en" | "zh";

export interface OutputFieldSummary {
  path: string;
  meaning: string;
  type: string;
}

export interface OutputSchemaSummary {
  fields: OutputFieldSummary[];
  total: number;
}

export interface PresentedOutputField extends OutputFieldSummary {
  label: string;
  description?: string;
  source?: AnalysisFieldSource;
}

export interface PresentedOutputSchemaSummary {
  fields: PresentedOutputField[];
  total: number;
}

const zhMeanings: Record<string, string> = {
  actionItems: "行动项",
  atMs: "出现时间（毫秒）",
  category: "类别",
  confidence: "置信度",
  contentTags: "内容标签",
  displayName: "显示名称",
  endMs: "结束时间（毫秒）",
  evidence: "判断依据",
  firstAppearanceAtMs: "首次出现时间（毫秒）",
  isSponsored: "是否含商业推广",
  keyPeople: "关键人物",
  keyPoints: "关键观点",
  label: "标签",
  name: "名称",
  numbers: "数字信息",
  originalText: "原文",
  organizations: "相关组织",
  overallSentiment: "整体情感倾向",
  price: "价格",
  products: "相关商品",
  quote: "相关原话",
  sentiment: "情感倾向",
  speaker: "说话人",
  startMs: "开始时间（毫秒）",
  summary: "摘要",
  supportingQuote: "佐证原话",
  translatedText: "中文翻译"
};

const zhTokens: Record<string, string> = {
  action: "行动",
  amount: "金额",
  content: "内容",
  description: "说明",
  emotion: "情绪",
  end: "结束",
  is: "是否",
  item: "条目",
  key: "关键",
  mood: "情绪",
  organization: "组织",
  overall: "整体",
  person: "人物",
  product: "商品",
  reason: "原因",
  speaker: "说话人",
  sponsored: "商业推广",
  start: "开始",
  tag: "标签",
  text: "文本",
  time: "时间",
  title: "标题",
  value: "值",
  sentiment: "情感倾向"
};

export function summarizeOutputSchema(serialized: string, language: OutputSchemaLanguage, visibleLimit = 8): OutputSchemaSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return { fields: [], total: 0 };
  }

  const allFields: OutputFieldSummary[] = [];
  if (isJsonSchema(parsed)) visitJsonSchema(parsed, "", language, allFields);
  else visitExampleValue(parsed, "", language, allFields);
  const safeLimit = Math.max(0, visibleLimit);
  return { fields: allFields.slice(0, safeLimit), total: allFields.length };
}

export function attachFieldDescriptions(summary: OutputSchemaSummary, descriptions: AnalysisFieldDescription[] = []): PresentedOutputSchemaSummary {
  const byPath = new Map(descriptions.map((description) => [description.path, description]));
  return {
    total: summary.total,
    fields: summary.fields.map((field) => {
      const description = byPath.get(field.path);
      return description
        ? { ...field, label: description.label, description: description.description, source: description.source }
        : { ...field, label: field.meaning };
    })
  };
}

function visitJsonSchema(schema: Record<string, unknown>, path: string, language: OutputSchemaLanguage, fields: OutputFieldSummary[]): void {
  if (schema.type === "array" && isRecord(schema.items)) {
    visitJsonSchema(schema.items, `${path}[]`, language, fields);
    return;
  }

  if ((schema.type === "object" || isRecord(schema.properties)) && isRecord(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      if (isRecord(child)) visitJsonSchema(child, path ? `${path}.${key}` : key, language, fields);
    }
    return;
  }

  if (!path) return;
  const kind = typeof schema.type === "string" ? schema.type : Array.isArray(schema.enum) ? valueKind(schema.enum[0]) : "unknown";
  const description = typeof schema.description === "string" ? schema.description.trim() : "";
  fields.push(createField(path, kind === "integer" ? "number" : kind, language, description || undefined));
}

function visitExampleValue(value: unknown, path: string, language: OutputSchemaLanguage, fields: OutputFieldSummary[]): void {
  if (Array.isArray(value)) {
    const arrayPath = `${path}[]`;
    if (value.length) visitExampleValue(value[0], arrayPath, language, fields);
    else if (path) fields.push(createField(arrayPath, "array", language));
    return;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length && path) fields.push(createField(path, "object", language));
    for (const [key, child] of entries) {
      visitExampleValue(child, path ? `${path}.${key}` : key, language, fields);
    }
    return;
  }

  if (path) fields.push(createField(path, valueKind(value), language));
}

function createField(path: string, kind: string, language: OutputSchemaLanguage, meaning?: string): OutputFieldSummary {
  return {
    path,
    meaning: meaning || fieldMeaning(path, language),
    type: typeLabel(kind, language)
  };
}

function fieldMeaning(path: string, language: OutputSchemaLanguage): string {
  const fieldName = path.split(".").at(-1)?.replace(/\[\]$/, "") || path;
  if (language === "en") return capitalize(splitFieldName(fieldName).join(" "));
  if (fieldName === "label" && /(^|\.)emotions?\[\]\.label$/.test(path)) return "情绪标签";
  if (zhMeanings[fieldName]) return zhMeanings[fieldName];
  const tokens = splitFieldName(fieldName);
  const translated = tokens.map((token) => zhTokens[singularize(token)] || "");
  return translated.every(Boolean) ? translated.join("") : fieldName;
}

function splitFieldName(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function singularize(value: string): string {
  return value.endsWith("ies") ? `${value.slice(0, -3)}y` : value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  return typeof value;
}

function typeLabel(kind: string, language: OutputSchemaLanguage): string {
  const labels = language === "zh"
    ? { string: "文本", number: "数字", boolean: "是 / 否", null: "空值", array: "列表", object: "对象" }
    : { string: "Text", number: "Number", boolean: "Boolean", null: "Null", array: "List", object: "Object" };
  return labels[kind as keyof typeof labels] || (language === "zh" ? "未知" : "Unknown");
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonSchema(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (typeof value.$schema === "string" || (value.type === "object" && isRecord(value.properties)) || (value.type === "array" && isRecord(value.items)));
}
