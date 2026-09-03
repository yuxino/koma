export interface DailyLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

interface Counter {
  day: string;
  count: number;
}

// Small in-memory guard for a single-node public demo. It deliberately has no
// external storage dependency; multi-instance deployments should rate-limit at
// the gateway instead.
export function createDailyLimiter(limit: number) {
  const counters = new Map<string, Counter>();

  return {
    consume(key: string, now = Date.now()): DailyLimitResult {
      if (limit <= 0) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetAt: nextUtcDay(now) };
      const day = new Date(now).toISOString().slice(0, 10);
      const current = counters.get(key);
      const count = current?.day === day ? current.count : 0;
      const allowed = count < limit;
      const nextCount = allowed ? count + 1 : count;
      counters.set(key, { day, count: nextCount });

      // Avoid retaining inactive visitor IPs forever on a long-running demo.
      if (counters.size > 10_000) {
        for (const [storedKey, value] of counters) {
          if (value.day !== day) counters.delete(storedKey);
        }
      }
      return { allowed, remaining: Math.max(0, limit - nextCount), resetAt: nextUtcDay(now) };
    }
  };
}

function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}
