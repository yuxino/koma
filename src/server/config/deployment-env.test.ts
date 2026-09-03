import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "dotenv";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];
const scriptPath = resolve(process.cwd(), "scripts/write-deployment-env.mjs");

const deploymentSettings = {
  MAX_UPLOAD_BYTES: "104857600",
  MAX_DURATION_SECONDS: "180",
  FRAME_WIDTH: "960",
  FRAME_SCENE_THRESHOLD: "0.55",
  MAX_FRAMES: "12",
  VISION_MAX_FRAMES: "6",
  VISION_TRANSCRIPT_CHARS: "12345",
  VISION_MAX_TOKENS: "1600",
  ARTIFACT_MAX_TOKENS: "3000",
  MAX_CONCURRENT_JOBS: "1",
  AI_TIMEOUT_MS: "90000",
  DASHSCOPE_TIMEOUT_MS: "91000",
  TEMP_ROOT: "/srv/koma/tmp",
  FFMPEG_PATH: "/opt/koma/bin/ffmpeg",
  FFPROBE_PATH: "/opt/koma/bin/ffprobe",
  YTDLP_PATH: "/opt/koma/bin/yt-dlp",
  ASR_SEGMENT_SECONDS: "45",
  ASR_MAX_SEGMENT_BYTES: "4194304",
  DASHSCOPE_WORKSPACE_ID: "workspace-test",
  DASHSCOPE_BASE_URL: "https://workspace-test.example.com/compatible-mode/v1",
  ANALYSIS_PROVIDER: "openai-compatible"
} as const;

const documentedDefaults = {
  MAX_UPLOAD_BYTES: "524288000",
  MAX_DURATION_SECONDS: "900",
  FRAME_WIDTH: "1280",
  FRAME_SCENE_THRESHOLD: "0.4",
  MAX_FRAMES: "18",
  VISION_MAX_FRAMES: "10",
  VISION_TRANSCRIPT_CHARS: "30000",
  VISION_MAX_TOKENS: "2000",
  ARTIFACT_MAX_TOKENS: "6000",
  MAX_CONCURRENT_JOBS: "2",
  AI_TIMEOUT_MS: "120000",
  DASHSCOPE_TIMEOUT_MS: "",
  TEMP_ROOT: "",
  FFMPEG_PATH: "",
  FFPROBE_PATH: "",
  YTDLP_PATH: "",
  ASR_SEGMENT_SECONDS: "60",
  ASR_MAX_SEGMENT_BYTES: "8388608",
  DASHSCOPE_WORKSPACE_ID: "",
  DASHSCOPE_BASE_URL: "",
  ANALYSIS_PROVIDER: ""
} as const;

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("deployment environment writer", () => {
  it("preserves supported custom settings from an existing .env", async () => {
    const target = await temporaryEnvFile();
    await writeFile(target, envText(deploymentSettings), "utf8");

    await runWriter(target);

    const written = parse(await readFile(target, "utf8"));
    expect(pick(written, Object.keys(deploymentSettings))).toEqual(deploymentSettings);
  });

  it("uses the documented runtime defaults for newly managed settings", async () => {
    const target = await temporaryEnvFile();

    await runWriter(target);

    const written = parse(await readFile(target, "utf8"));
    expect(pick(written, Object.keys(documentedDefaults))).toEqual(documentedDefaults);
  });
});

async function temporaryEnvFile(): Promise<string> {
  const directory = await mkdtemp(join(os.tmpdir(), "koma-deployment-env-test-"));
  cleanup.push(directory);
  return join(directory, ".env");
}

async function runWriter(target: string): Promise<void> {
  const managed = new Set([...Object.keys(deploymentSettings), "APP_PORT"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined && !managed.has(name))) as NodeJS.ProcessEnv;
  await execFileAsync(process.execPath, [scriptPath, target], { cwd: process.cwd(), env });
}

function envText(values: Record<string, string>): string {
  return `${Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n")}\n`;
}

function pick(values: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}
