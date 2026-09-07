import { chmod, lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

interface RetrySource { filename: string; size: number }
interface RetrySourceJob { dir: string; status: string; inputPath?: string; localRetrySource?: RetrySource }
const MANIFEST = "retry-source.json";

// Written only after an entire input has arrived and OSS failed to retain it.
// Keep this private source until the owner deletes the failed job; never serve it directly.
export async function retainRetrySource(job: RetrySourceJob): Promise<void> {
  if (!job.inputPath || resolve(dirname(job.inputPath)) !== resolve(job.dir)) return;
  const filename = basename(job.inputPath);
  if (!validFilename(filename)) return;
  const info = await lstat(job.inputPath);
  if (!info.isFile() || info.size <= 0) return;
  job.localRetrySource = { filename, size: info.size };
  await chmod(job.dir, 0o700);
  await chmod(job.inputPath, 0o600);
  await writeFile(join(job.dir, MANIFEST), JSON.stringify(job.localRetrySource), { mode: 0o600 });
}

export async function retainedInputPath(job: RetrySourceJob): Promise<string | undefined> {
  if (job.status !== "failed") return undefined;
  try {
    const source: unknown = job.localRetrySource || JSON.parse(await readFile(join(job.dir, MANIFEST), "utf8"));
    if (!source || typeof source !== "object") return undefined;
    const { filename, size } = source as Partial<RetrySource>;
    if (typeof filename !== "string" || !validFilename(filename) || !Number.isSafeInteger(size) || !size || size < 0) return undefined;
    const path = join(job.dir, filename);
    const info = await lstat(path);
    return info.isFile() && info.size === size ? path : undefined;
  } catch { return undefined; }
}

function validFilename(filename: string): boolean {
  return /^input\.[a-z0-9]{2,5}$/.test(filename);
}
