import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export interface PersistedJobRecord {
  id: string;
  source: "upload" | "url";
  title: string;
  status: string;
  stage: string;
  percent: number;
  detail: string;
  language: "en" | "zh";
  analysisSpec: unknown;
  result: unknown | null;
  asrProvider: string;
  asrModel: string;
  visionProvider: string;
  visionModel: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  storagePrefix: string;
  inputObjectKey: string | null;
  inputMimeType: string | null;
  mediaAvailable: boolean;
  error: string | null;
}

export type JobHistoryRecord = Omit<PersistedJobRecord, "analysisSpec" | "result" | "inputObjectKey" | "inputMimeType">;
type DatabaseDriver = "sqlite" | "mysql";

let sqliteDatabase: DatabaseSync | null = null;
let mysqlPool: Pool | null = null;
let initialization: Promise<void> | null = null;

export function databaseDriver(): DatabaseDriver {
  const configured = String(process.env.DB_DRIVER || "").trim().toLowerCase();
  if (configured && configured !== "sqlite" && configured !== "mysql") throw new Error(`不支持的 DB_DRIVER：${configured}`);
  return configured === "mysql" || (!configured && Boolean(process.env.DB_HOST)) ? "mysql" : "sqlite";
}

export function initializeDatabase(): Promise<void> {
  if (!initialization) {
    initialization = initializeSelectedDatabase().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export async function readSetting(key: string): Promise<string | null> {
  await initializeDatabase();
  if (databaseDriver() === "mysql") {
    const [rows] = await mysqlPool!.query<Array<RowDataPacket & { value: string }>>("SELECT value FROM koma_settings WHERE setting_key = ?", [key]);
    return typeof rows[0]?.value === "string" ? rows[0].value : null;
  }
  const row = sqliteDatabase!.prepare("SELECT value FROM koma_settings WHERE setting_key = ?").get(key) as { value?: unknown } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export async function writeSetting(key: string, value: string, now = Date.now()): Promise<void> {
  await initializeDatabase();
  if (databaseDriver() === "mysql") {
    await mysqlPool!.execute(`
      INSERT INTO koma_settings (setting_key, value, updated_at) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)
    `, [key, value, now]);
    return;
  }
  sqliteDatabase!.prepare(`
    INSERT INTO koma_settings (setting_key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export async function writeJobRecord(record: PersistedJobRecord): Promise<void> {
  await initializeDatabase();
  const values = jobValues(record);
  if (databaseDriver() === "mysql") {
    await mysqlPool!.execute(`
      INSERT INTO koma_jobs (${JOB_COLUMNS.join(", ")}) VALUES (${JOB_COLUMNS.map(() => "?").join(", ")})
      ON DUPLICATE KEY UPDATE
        source = VALUES(source), title = VALUES(title), status = VALUES(status), stage = VALUES(stage),
        percent = VALUES(percent), detail = VALUES(detail), language = VALUES(language),
        analysis_spec_json = VALUES(analysis_spec_json), result_json = VALUES(result_json),
        asr_provider = VALUES(asr_provider), asr_model = VALUES(asr_model),
        vision_provider = VALUES(vision_provider), vision_model = VALUES(vision_model),
        updated_at = VALUES(updated_at), completed_at = VALUES(completed_at),
        storage_prefix = VALUES(storage_prefix), input_object_key = VALUES(input_object_key),
        input_mime_type = VALUES(input_mime_type), media_available = VALUES(media_available), error = VALUES(error)
    `, values);
    return;
  }
  sqliteDatabase!.prepare(`
    INSERT INTO koma_jobs (${JOB_COLUMNS.join(", ")}) VALUES (${JOB_COLUMNS.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET
      source = excluded.source, title = excluded.title, status = excluded.status, stage = excluded.stage,
      percent = excluded.percent, detail = excluded.detail, language = excluded.language,
      analysis_spec_json = excluded.analysis_spec_json, result_json = excluded.result_json,
      asr_provider = excluded.asr_provider, asr_model = excluded.asr_model,
      vision_provider = excluded.vision_provider, vision_model = excluded.vision_model,
      updated_at = excluded.updated_at, completed_at = excluded.completed_at,
      storage_prefix = excluded.storage_prefix, input_object_key = excluded.input_object_key,
      input_mime_type = excluded.input_mime_type, media_available = excluded.media_available, error = excluded.error
  `).run(...values);
}

export async function readJobRecord(id: string): Promise<PersistedJobRecord | null> {
  await initializeDatabase();
  const sql = `SELECT ${JOB_COLUMNS.join(", ")} FROM koma_jobs WHERE id = ?`;
  const row = databaseDriver() === "mysql"
    ? ((await mysqlPool!.query<RowDataPacket[]>(sql, [id]))[0][0] as Record<string, unknown> | undefined)
    : sqliteDatabase!.prepare(sql).get(id) as Record<string, unknown> | undefined;
  return row ? normalizeJobRow(row) : null;
}

export async function writeJobOwner(jobId: string, ownerId: string, now = Date.now()): Promise<void> {
  await initializeDatabase();
  if (!/^[a-f0-9]{64}$/.test(ownerId)) throw new Error("任务访客身份无效。");
  if (databaseDriver() === "mysql") {
    await mysqlPool!.execute(`
      INSERT INTO koma_job_owners (job_id, owner_hash, created_at) VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE owner_hash = VALUES(owner_hash)
    `, [jobId, ownerId, now]);
    return;
  }
  sqliteDatabase!.prepare(`
    INSERT INTO koma_job_owners (job_id, owner_hash, created_at) VALUES (?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET owner_hash = excluded.owner_hash
  `).run(jobId, ownerId, now);
}

export async function readJobOwner(jobId: string): Promise<string | null> {
  await initializeDatabase();
  const sql = "SELECT owner_hash FROM koma_job_owners WHERE job_id = ?";
  const row = databaseDriver() === "mysql"
    ? ((await mysqlPool!.query<Array<RowDataPacket & { owner_hash: string }>>(sql, [jobId]))[0][0])
    : sqliteDatabase!.prepare(sql).get(jobId) as { owner_hash?: unknown } | undefined;
  return typeof row?.owner_hash === "string" ? row.owner_hash : null;
}

export async function listJobHistory(limit = 100): Promise<JobHistoryRecord[]> {
  await initializeDatabase();
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const sql = `SELECT ${HISTORY_COLUMNS.join(", ")} FROM koma_jobs ORDER BY created_at DESC LIMIT ?`;
  const rows = databaseDriver() === "mysql"
    ? (await mysqlPool!.query<RowDataPacket[]>(sql, [safeLimit]))[0] as Array<Record<string, unknown>>
    : sqliteDatabase!.prepare(sql).all(safeLimit) as Array<Record<string, unknown>>;
  return rows.map(historyFromRow);
}

export async function listOwnedJobHistory(ownerId: string, limit = 100): Promise<JobHistoryRecord[]> {
  await initializeDatabase();
  if (!/^[a-f0-9]{64}$/.test(ownerId)) return [];
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const selectedColumns = HISTORY_COLUMNS.map((column) => `j.${column}`).join(", ");
  const sql = `
    SELECT ${selectedColumns}
    FROM koma_jobs j
    INNER JOIN koma_job_owners o ON o.job_id = j.id
    WHERE o.owner_hash = ?
    ORDER BY j.created_at DESC
    LIMIT ?
  `;
  const rows = databaseDriver() === "mysql"
    ? (await mysqlPool!.query<RowDataPacket[]>(sql, [ownerId, safeLimit]))[0] as Array<Record<string, unknown>>
    : sqliteDatabase!.prepare(sql).all(ownerId, safeLimit) as Array<Record<string, unknown>>;
  return rows.map(historyFromRow);
}

export async function deleteJobRecord(id: string): Promise<void> {
  await initializeDatabase();
  if (databaseDriver() === "mysql") {
    await mysqlPool!.execute("DELETE FROM koma_job_owners WHERE job_id = ?", [id]);
    await mysqlPool!.execute("DELETE FROM koma_jobs WHERE id = ?", [id]);
  } else {
    sqliteDatabase!.prepare("DELETE FROM koma_job_owners WHERE job_id = ?").run(id);
    sqliteDatabase!.prepare("DELETE FROM koma_jobs WHERE id = ?").run(id);
  }
}

export async function markInterruptedJobs(now = Date.now()): Promise<void> {
  await initializeDatabase();
  const detail = "服务重启中断了这次分析，请重新提交。";
  const sql = "UPDATE koma_jobs SET status = 'failed', stage = 'failed', percent = 100, detail = ?, error = ?, updated_at = ? WHERE status IN ('queued', 'processing')";
  if (databaseDriver() === "mysql") await mysqlPool!.execute(sql, [detail, detail, now]);
  else sqliteDatabase!.prepare(sql).run(detail, detail, now);
}

export async function closeDatabase(): Promise<void> {
  sqliteDatabase?.close();
  sqliteDatabase = null;
  if (mysqlPool) await mysqlPool.end();
  mysqlPool = null;
  initialization = null;
}

const JOB_COLUMNS = [
  "id", "source", "title", "status", "stage", "percent", "detail", "language",
  "analysis_spec_json", "result_json", "asr_provider", "asr_model", "vision_provider", "vision_model",
  "created_at", "updated_at", "completed_at", "storage_prefix", "input_object_key", "input_mime_type",
  "media_available", "error"
] as const;

const HISTORY_COLUMNS = [
  "id", "source", "title", "status", "stage", "percent", "detail", "language",
  "asr_provider", "asr_model", "vision_provider", "vision_model", "created_at", "updated_at",
  "completed_at", "storage_prefix", "media_available", "error"
] as const;

async function initializeSelectedDatabase(): Promise<void> {
  if (databaseDriver() === "mysql") {
    const database = databaseName();
    if (booleanEnv(process.env.DB_AUTO_CREATE, true)) {
      const connection = await mysql.createConnection(mysqlConnectionOptions());
      try {
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      } finally {
        await connection.end();
      }
    }
    mysqlPool = mysql.createPool({
      ...mysqlConnectionOptions(),
      database,
      waitForConnections: true,
      connectionLimit: positiveInteger(process.env.DB_CONNECTION_LIMIT, 5),
      enableKeepAlive: true
    });
    await mysqlPool.query("SELECT 1");
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS koma_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        value LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS koma_jobs (
        id VARCHAR(64) PRIMARY KEY,
        source VARCHAR(16) NOT NULL,
        title VARCHAR(512) NOT NULL,
        status VARCHAR(32) NOT NULL,
        stage VARCHAR(64) NOT NULL,
        percent INT NOT NULL,
        detail VARCHAR(1000) NOT NULL,
        language VARCHAR(8) NOT NULL,
        analysis_spec_json LONGTEXT NOT NULL,
        result_json LONGTEXT NULL,
        asr_provider VARCHAR(64) NOT NULL,
        asr_model VARCHAR(300) NOT NULL,
        vision_provider VARCHAR(64) NOT NULL,
        vision_model VARCHAR(300) NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        completed_at BIGINT NULL,
        storage_prefix VARCHAR(700) NOT NULL,
        input_object_key VARCHAR(1000) NULL,
        input_mime_type VARCHAR(200) NULL,
        media_available TINYINT(1) NOT NULL DEFAULT 0,
        error TEXT NULL,
        INDEX koma_jobs_created_at_idx (created_at),
        INDEX koma_jobs_status_idx (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS koma_job_owners (
        job_id VARCHAR(64) PRIMARY KEY,
        owner_hash CHAR(64) NOT NULL,
        created_at BIGINT NOT NULL,
        INDEX koma_job_owners_owner_created_idx (owner_hash, created_at),
        CONSTRAINT koma_job_owners_job_fk FOREIGN KEY (job_id) REFERENCES koma_jobs(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } else {
    const path = process.env.KOMA_DATABASE_PATH || join(process.cwd(), "data", "koma.sqlite");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const { DatabaseSync } = await import("node:sqlite");
    sqliteDatabase = new DatabaseSync(path);
    sqliteDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS koma_settings (
        setting_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS koma_jobs (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        percent INTEGER NOT NULL,
        detail TEXT NOT NULL,
        language TEXT NOT NULL,
        analysis_spec_json TEXT NOT NULL,
        result_json TEXT,
        asr_provider TEXT NOT NULL,
        asr_model TEXT NOT NULL,
        vision_provider TEXT NOT NULL,
        vision_model TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        storage_prefix TEXT NOT NULL,
        input_object_key TEXT,
        input_mime_type TEXT,
        media_available INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS koma_job_owners (
        job_id TEXT PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(job_id) REFERENCES koma_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS koma_jobs_created_at_idx ON koma_jobs(created_at DESC);
      CREATE INDEX IF NOT EXISTS koma_jobs_status_idx ON koma_jobs(status);
      CREATE INDEX IF NOT EXISTS koma_job_owners_owner_created_idx ON koma_job_owners(owner_hash, created_at DESC);
    `);
  }
}

function jobValues(record: PersistedJobRecord): Array<string | number | null> {
  return [
    record.id, record.source, record.title, record.status, record.stage, record.percent, record.detail, record.language,
    JSON.stringify(record.analysisSpec || {}), record.result == null ? null : JSON.stringify(record.result),
    record.asrProvider, record.asrModel, record.visionProvider, record.visionModel,
    record.createdAt, record.updatedAt, record.completedAt, record.storagePrefix, record.inputObjectKey, record.inputMimeType,
    record.mediaAvailable ? 1 : 0, record.error
  ];
}

function normalizeJobRow(row: Record<string, unknown>): PersistedJobRecord {
  const history = historyFromRow(row);
  return {
    ...history,
    analysisSpec: parseJson(row.analysis_spec_json, {}),
    result: row.result_json == null ? null : parseJson(row.result_json, null),
    inputObjectKey: typeof row.input_object_key === "string" ? row.input_object_key : null,
    inputMimeType: typeof row.input_mime_type === "string" ? row.input_mime_type : null
  };
}

function historyFromRow(row: Record<string, unknown>): JobHistoryRecord {
  return {
    id: String(row.id),
    source: row.source === "url" ? "url" : "upload",
    title: String(row.title),
    status: String(row.status),
    stage: String(row.stage),
    percent: Number(row.percent),
    detail: String(row.detail),
    language: row.language === "en" ? "en" : "zh",
    asrProvider: String(row.asr_provider),
    asrModel: String(row.asr_model),
    visionProvider: String(row.vision_provider),
    visionModel: String(row.vision_model),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    storagePrefix: String(row.storage_prefix),
    mediaAvailable: Number(row.media_available) === 1,
    error: typeof row.error === "string" ? row.error : null
  };
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as unknown; } catch { return fallback; }
}

function mysqlConnectionOptions() {
  return {
    host: requiredEnv("DB_HOST"),
    port: positiveInteger(process.env.DB_PORT, 3306),
    user: requiredEnv("DB_USER"),
    password: requiredEnv("DB_PASSWORD"),
    charset: "utf8mb4",
    ...(booleanEnv(process.env.DB_SSL, false) ? { ssl: {} } : {})
  };
}

function databaseName(): string {
  const value = String(process.env.DB_NAME || "koma").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error("DB_NAME 只能包含字母、数字和下划线。");
  return value;
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`DB_DRIVER=mysql 时必须配置 ${name}。`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  return fallback;
}
