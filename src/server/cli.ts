#!/usr/bin/env node
// Koma headless mode: analyze a local video or video URL and output JSON.
// Usage:
//   node dist-server/cli.js <video path or URL> [--json output] [--frames-dir directory]
// Progress is written to stderr. Analysis output is written to stdout or --json.
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { config } from "./config/config.js";
import { downloadUrl } from "./media/download.js";
import { analyzeMedia } from "./application/pipeline.js";
import { resolveVideoUrl } from "./media/resolver.js";
import { parseAnalysisSpec, type ArtifactFormat } from "./analysis/analysis-spec.js";

const HELP = `Koma CLI

Usage:
  node dist-server/cli.js <video path or URL> [options]

Options:
  --json <path>        Write analysis result to a JSON file
  --frames-dir <path>  Keep extracted key frames in this directory
  --lang <en|zh>       Language for AI-generated copy (title, summary, tags); default zh
  --instruction <text> Custom extraction requirement
  --schema <path>      JSON example or JSON Schema file for extractedData
  --artifact <format>  Generate a file: json, csv, markdown, srt, or text (repeatable)
  --artifacts-dir <p>  Save generated files in this directory
  --extraction-only    Output only the requested JSON instead of the full Koma result
  -h, --help           Show help
`;

interface CliOptions {
  input: string;
  jsonPath: string | null;
  framesDir: string | null;
  language: "en" | "zh";
  instruction: string | null;
  schemaPath: string | null;
  extractionOnly: boolean;
  artifactFormats: ArtifactFormat[];
  artifactsDir: string | null;
}

async function main(): Promise<void> {
  const { input, jsonPath, framesDir, language, instruction, schemaPath, extractionOnly, artifactFormats, artifactsDir } = parseArgs(process.argv.slice(2));
  const tempDir = await mkdtemp(join(config.tempRoot, "koma-cli-"));
  let inputPath: string;
  try {
    inputPath = await prepareInput(input, tempDir);
    const title = basename(inputPath);
    const outputSchema = schemaPath ? await readFile(resolve(schemaPath), "utf8") : undefined;
    const analysisSpec = parseAnalysisSpec({ instruction, outputSchema, artifactFormats });
    if (extractionOnly && !analysisSpec.instruction && analysisSpec.outputSchema === undefined) {
      throw new Error("--extraction-only requires --instruction or --schema.");
    }
    const result = await analyzeMedia({
      inputPath,
      title,
      framesDir: join(tempDir, "frames"),
      audioDir: join(tempDir, "audio"),
      language,
      analysisSpec,
      onProgress: (progress) => console.error(`[koma] ${progress.percent}% ${progress.detail}`)
    });

    if (config.asrProvider === "mock") console.error("[koma] ASR is running in demo mode. Configure an ASR provider key for real transcription.");
    if (config.visionProvider === "mock") console.error("[koma] Vision analysis is running in demo mode. Configure a vision model API key for real analysis.");

    if (framesDir) {
      const target = resolve(framesDir);
      await mkdir(target, { recursive: true });
      for (const frame of result.frames) {
        const targetPath = join(target, frame.filename);
        await copyFile(join(tempDir, "frames", frame.filename), targetPath);
        frame.path = targetPath;
      }
      console.error(`[koma] Key frames saved to ${target}`);
    }

    if (artifactsDir && result.artifacts?.length) {
      const target = resolve(artifactsDir);
      await mkdir(target, { recursive: true });
      for (const artifact of result.artifacts) await writeFile(join(target, artifact.name), artifact.content, "utf8");
      console.error(`[koma] ${result.artifacts.length} generated file(s) saved to ${target}`);
    }

    const payload = JSON.stringify(extractionOnly ? result.extractedData : result, null, 2) + "\n";
    if (jsonPath) {
      await writeFile(resolve(jsonPath), payload, "utf8");
      console.error(`[koma] Result written to ${jsonPath}`);
    } else {
      process.stdout.write(payload);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function prepareInput(input: string, tempDir: string): Promise<string> {
  if (/^https?:\/\//i.test(input)) {
    const outputPath = join(tempDir, "input.mp4");
    // 分享链接（抖音/B站等）先解析成真实播放地址，直链原样使用
    console.error(`[koma] Resolving ${input}`);
    const resolved = await resolveVideoUrl(input);
    if (resolved.title) console.error(`[koma] Title: ${resolved.title}`);
    console.error(`[koma] Downloading ${resolved.url}`);
    // 复用 HTTP 服务的下载逻辑：自带时长预检、取消支持和重试
    await downloadUrl(resolved.url, outputPath, { referer: resolved.referer });
    return outputPath;
  }
  const inputPath = resolve(input);
  try {
    await stat(inputPath);
  } catch {
    throw new Error(`Video file not found: ${input}`);
  }
  return inputPath;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { input: "", jsonPath: null, framesDir: null, language: "zh", instruction: null, schemaPath: null, extractionOnly: false, artifactFormats: [], artifactsDir: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (arg === "--json") {
      options.jsonPath = args[++index];
      if (!options.jsonPath) throw new Error("--json requires a file path.");
    } else if (arg === "--frames-dir") {
      options.framesDir = args[++index];
      if (!options.framesDir) throw new Error("--frames-dir requires a directory path.");
    } else if (arg === "--lang") {
      const value = args[++index];
      if (value !== "en" && value !== "zh") throw new Error("--lang accepts en or zh.");
      options.language = value;
    } else if (arg === "--instruction") {
      options.instruction = args[++index];
      if (!options.instruction) throw new Error("--instruction requires text.");
    } else if (arg === "--schema") {
      options.schemaPath = args[++index];
      if (!options.schemaPath) throw new Error("--schema requires a JSON file path.");
    } else if (arg === "--extraction-only") {
      options.extractionOnly = true;
    } else if (arg === "--artifact") {
      const format = args[++index];
      const parsed = parseAnalysisSpec({ artifactFormats: format }).artifactFormats;
      if (!parsed?.[0]) throw new Error("--artifact requires json, csv, markdown, srt, or text.");
      if (!options.artifactFormats.includes(parsed[0])) options.artifactFormats.push(parsed[0]);
    } else if (arg === "--artifacts-dir") {
      options.artifactsDir = args[++index];
      if (!options.artifactsDir) throw new Error("--artifacts-dir requires a directory path.");
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!options.input) throw new Error("Provide a video file path or video URL. Use --help for usage.");
  return options;
}

main().catch((error) => {
  console.error(`[koma] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
