import { randomUUID } from "node:crypto";

// 说话人分离需要把音频临时放到一个公网可访问的地址上交给百炼异步转写。
// 这里只登记本机文件路径，路由按随机 token 对外暴露，任务结束或到期即失效。
const entries = new Map<string, { filePath: string; expiresAt: number }>();

export function registerTempAudio(filePath: string, ttlMs = 15 * 60_000): string {
  const token = randomUUID();
  entries.set(token, { filePath, expiresAt: Date.now() + ttlMs });
  // 到期自动移除条目，避免异常路径下 Map 无限增长
  setTimeout(() => entries.delete(token), ttlMs).unref?.();
  return token;
}

export function getTempAudio(token: string): string | null {
  const entry = entries.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    entries.delete(token);
    return null;
  }
  return entry.filePath;
}

export function removeTempAudio(token: string): void {
  entries.delete(token);
}
