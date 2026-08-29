import { chmod, readFile, writeFile } from "node:fs/promises";
import { parse } from "dotenv";

const target = process.argv[2] || ".env";
let existing = {};
try {
  existing = parse(await readFile(target, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const specs = [
  ["PORT", "APP_PORT", "3000"],
  ["MAX_UPLOAD_BYTES", null, "524288000"],
  ["MAX_DURATION_SECONDS", null, "900"],
  ["FRAME_WIDTH", null, "1280"],
  ["FRAME_SCENE_THRESHOLD", null, "0.4"],
  ["MAX_FRAMES", null, "18"],
  ["VISION_MAX_FRAMES", null, "10"],
  ["VISION_TRANSCRIPT_CHARS", null, "30000"],
  ["VISION_MAX_TOKENS", null, "2000"],
  ["ARTIFACT_MAX_TOKENS", null, "6000"],
  ["MAX_CONCURRENT_JOBS", null, "2"],
  ["AI_TIMEOUT_MS", null, "120000"],
  ["DASHSCOPE_TIMEOUT_MS"],
  ["TEMP_ROOT"], ["FFMPEG_PATH"], ["FFPROBE_PATH"], ["YTDLP_PATH"],
  ["ASR_PROVIDER"], ["ASR_API_KEY"], ["ASR_BASE_URL"], ["ASR_MODEL"],
  ["ASR_SEGMENT_SECONDS", null, "60"], ["ASR_MAX_SEGMENT_BYTES", null, "8388608"],
  ["DASHSCOPE_API_KEY"], ["GROQ_API_KEY"], ["OPENAI_API_KEY"],
  ["DASHSCOPE_WORKSPACE_ID"], ["DASHSCOPE_BASE_URL"],
  ["VISION_PROVIDER"], ["ANALYSIS_PROVIDER"], ["VISION_API_KEY"], ["VISION_BASE_URL"], ["VISION_MODEL"],
  ["GEMINI_API_KEY"], ["OPENROUTER_API_KEY"],
  ["PUBLIC_BASE_URL"], ["ASR_DIARIZATION", null, "off"],
  ["DEMO_REQUESTS_PER_IP_PER_DAY", null, "0"],
  ["ADMIN_PASSWORD"], ["ANALYSIS_REQUIRE_ADMIN", null, "false"], ["KOMA_CONFIG_SECRET"],
  ["DB_DRIVER", null, "sqlite"], ["KOMA_DATABASE_PATH", null, "./data/koma.sqlite"],
  ["DB_HOST"], ["DB_PORT", null, "3306"], ["DB_USER"], ["DB_PASSWORD"], ["DB_NAME", null, "koma"],
  ["DB_SSL", null, "false"], ["DB_CONNECTION_LIMIT", null, "5"], ["DB_AUTO_CREATE", null, "true"],
  ["STORAGE_DRIVER", null, "local"], ["LOCAL_STORAGE_PATH", null, "./data/storage"],
  ["OSS_REGION"], ["OSS_ACCESS_KEY_ID"], ["OSS_ACCESS_KEY_SECRET"], ["OSS_BUCKET"],
  ["OSS_UPLOAD_PREFIX", null, "koma"], ["OSS_PUBLIC_BASE_URL"],
  ["OSS_SIGNED_URL_SECONDS", null, "900"], ["OSS_TIMEOUT_MS", null, "120000"],
  ["TRUST_PROXY", null, "true"]
];

const lines = specs.map(([name, source = name, fallback = ""]) => {
  const incoming = clean(process.env[source || name]);
  const current = clean(existing[name]);
  return `${name}=${JSON.stringify(incoming || current || fallback)}`;
});

await writeFile(target, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
await chmod(target, 0o600);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
