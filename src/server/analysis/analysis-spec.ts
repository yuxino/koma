export const MAX_ANALYSIS_INSTRUCTION_CHARS = 4_000;
export const MAX_OUTPUT_SCHEMA_CHARS = 12_000;
export const ARTIFACT_FORMATS = ["json", "csv", "markdown", "srt", "text"] as const;
export type ArtifactFormat = typeof ARTIFACT_FORMATS[number];

export interface AnalysisSpec {
  instruction?: string;
  outputSchema?: unknown;
  /** Optional downloadable text artifacts requested in addition to extractedData. */
  artifactFormats?: ArtifactFormat[];
}

interface AnalysisSpecInput {
  instruction?: unknown;
  outputSchema?: unknown;
  artifactFormats?: unknown;
}

/**
 * Normalize the optional user-defined extraction request accepted by HTTP and CLI callers.
 * `outputSchema` may already be JSON (URL API) or a JSON string (multipart form / CLI file).
 */
export function parseAnalysisSpec(input: AnalysisSpecInput = {}): AnalysisSpec {
  const instruction = normalizeInstruction(input.instruction);
  const outputSchema = normalizeOutputSchema(input.outputSchema);
  const artifactFormats = normalizeArtifactFormats(input.artifactFormats);
  return {
    ...(instruction ? { instruction } : {}),
    ...(outputSchema !== undefined ? { outputSchema } : {}),
    ...(artifactFormats.length ? { artifactFormats } : {})
  };
}

export function hasCustomAnalysis(spec: AnalysisSpec): boolean {
  return Boolean(spec.instruction || spec.outputSchema !== undefined || spec.artifactFormats?.length);
}

export function hasExtractionRequest(spec: AnalysisSpec): boolean {
  return Boolean(spec.instruction || spec.outputSchema !== undefined);
}

/**
 * Validate model output against either a JSON example or the common structural
 * subset of JSON Schema (type, required, properties, items, enum, min/maxItems,
 * and additionalProperties=false). Providers still receive the full shape in
 * the prompt; this guard catches malformed results before a job is marked done.
 */
export function assertMatchesOutputShape(value: unknown, outputShape: unknown): void {
  if (outputShape === undefined) return;
  const issue = looksLikeJsonSchema(outputShape)
    ? validateJsonSchema(value, outputShape as Record<string, unknown>, "$", 0)
    : validateJsonExample(value, outputShape, "$", 0);
  if (issue) throw new Error(`结构化提取结果与期望 JSON 结构不匹配：${issue}`);
}

function normalizeInstruction(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw badRequest("分析要求必须是文本。");
  const instruction = value.trim();
  if (!instruction) return undefined;
  if (instruction.length > MAX_ANALYSIS_INSTRUCTION_CHARS) {
    throw badRequest(`分析要求最多 ${MAX_ANALYSIS_INSTRUCTION_CHARS} 个字符。`);
  }
  return instruction;
}

function normalizeOutputSchema(value: unknown): unknown {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return undefined;
    if (raw.length > MAX_OUTPUT_SCHEMA_CHARS) throw badRequest(`期望 JSON 结构最多 ${MAX_OUTPUT_SCHEMA_CHARS} 个字符。`);
    try {
      return assertContainer(JSON.parse(raw));
    } catch (error) {
      if (isStatusError(error)) throw error;
      throw badRequest("期望 JSON 结构不是有效 JSON。");
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw badRequest("期望 JSON 结构必须可以序列化为 JSON。");
  }
  if (!serialized || serialized.length > MAX_OUTPUT_SCHEMA_CHARS) {
    throw badRequest(`期望 JSON 结构最多 ${MAX_OUTPUT_SCHEMA_CHARS} 个字符。`);
  }
  return assertContainer(value);
}

function normalizeArtifactFormats(value: unknown): ArtifactFormat[] {
  if (value == null || value === "") return [];
  let candidates: unknown[];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) throw new Error("not an array");
        candidates = parsed;
      } catch {
        throw badRequest("输出文件格式不是有效列表。");
      }
    } else {
      candidates = raw.split(",");
    }
  } else {
    throw badRequest("输出文件格式必须是列表。");
  }
  const seen = new Set<ArtifactFormat>();
  for (const candidate of candidates) {
    const format = String(candidate).trim().toLowerCase() as ArtifactFormat;
    if (!ARTIFACT_FORMATS.includes(format)) throw badRequest(`不支持的输出文件格式：${format || String(candidate)}`);
    seen.add(format);
  }
  return [...seen];
}

function assertContainer(value: unknown): unknown {
  if (value === null || typeof value !== "object") throw badRequest("期望 JSON 结构必须是对象或数组。");
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (current.depth > 32 || nodes > 2_000) throw badRequest("期望 JSON 结构过于复杂，请减少嵌套层级或字段数量。");
    if (current.value && typeof current.value === "object") {
      for (const child of Object.values(current.value as Record<string, unknown>)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return value;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function isStatusError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && typeof (error as { statusCode?: unknown }).statusCode === "number";
}

function looksLikeJsonSchema(value: unknown): boolean {
  if (!isObject(value)) return false;
  return ["$schema", "properties", "required", "items", "additionalProperties", "oneOf", "anyOf", "allOf"].some((key) => key in value);
}

function validateJsonExample(value: unknown, example: unknown, path: string, depth: number): string | null {
  if (depth > 32) return `${path} 嵌套过深`;
  if (example === null) return null;
  if (Array.isArray(example)) {
    if (!Array.isArray(value)) return `${path} 应为数组`;
    if (example.length) {
      for (let index = 0; index < value.length; index += 1) {
        const issue = validateJsonExample(value[index], example[0], `${path}[${index}]`, depth + 1);
        if (issue) return issue;
      }
    }
    return null;
  }
  if (isObject(example)) {
    if (!isObject(value)) return `${path} 应为对象`;
    const expectedKeys = Object.keys(example);
    for (const key of expectedKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return `${path}.${key} 缺失`;
      const issue = validateJsonExample(value[key], example[key], `${path}.${key}`, depth + 1);
      if (issue) return issue;
    }
    const unexpected = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(example, key));
    return unexpected ? `${path}.${unexpected} 不在目标结构中` : null;
  }
  const expectedType = placeholderType(example);
  if (expectedType === "integer") return typeof value === "number" && Number.isInteger(value) ? null : `${path} 应为整数`;
  return expectedType && jsonType(value) !== expectedType ? `${path} 应为 ${typeLabel(expectedType)}` : null;
}

function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path: string, depth: number): string | null {
  if (depth > 32) return `${path} 嵌套过深`;
  const allOf = Array.isArray(schema.allOf) ? schema.allOf.filter(isObject) : [];
  for (const childSchema of allOf) {
    const issue = validateJsonSchema(value, childSchema, path, depth + 1);
    if (issue) return issue;
  }
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isObject) : [];
  if (anyOf.length && !anyOf.some((childSchema) => validateJsonSchema(value, childSchema, path, depth + 1) === null)) return `${path} 不符合 anyOf 中的任一结构`;
  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf.filter(isObject) : [];
  if (oneOf.length && oneOf.filter((childSchema) => validateJsonSchema(value, childSchema, path, depth + 1) === null).length !== 1) return `${path} 必须且只能符合 oneOf 中的一种结构`;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return `${path} 不在允许值中`;
  }
  const allowedTypes = Array.isArray(schema.type) ? schema.type.filter((item): item is string => typeof item === "string") : typeof schema.type === "string" ? [schema.type] : [];
  const matchesType = allowedTypes.some((type) => type === "integer" ? typeof value === "number" && Number.isInteger(value) : jsonType(value) === type);
  if (allowedTypes.length && !matchesType) return `${path} 应为 ${allowedTypes.map(typeLabel).join(" 或 ")}`;

  if (isObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : [];
    for (const key of required) if (!Object.prototype.hasOwnProperty.call(value, key)) return `${path}.${key} 缺失`;
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key) && isObject(childSchema)) {
        const issue = validateJsonSchema(value[key], childSchema, `${path}.${key}`, depth + 1);
        if (issue) return issue;
      }
    }
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).find((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      if (unexpected) return `${path}.${unexpected} 不被 Schema 允许`;
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path} 至少需要 ${schema.minItems} 项`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path} 最多允许 ${schema.maxItems} 项`;
    if (isObject(schema.items)) {
      for (let index = 0; index < value.length; index += 1) {
        const issue = validateJsonSchema(value[index], schema.items, `${path}[${index}]`, depth + 1);
        if (issue) return issue;
      }
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function placeholderType(value: unknown): string | null {
  if (typeof value === "string" && ["string", "number", "integer", "boolean", "object", "array", "null"].includes(value)) return value;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  return null;
}

function typeLabel(type: string): string {
  return ({ object: "对象", array: "数组", string: "字符串", number: "数字", integer: "整数", boolean: "布尔值", null: "null" } as Record<string, string>)[type] || type;
}
