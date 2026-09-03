export interface ByteRange {
  start: number;
  end: number;
}

// 解析 Range 头，返回 [start, end]；不合法或越界时返回 null。
export function parseByteRange(rangeHeader: string | undefined, size: number): ByteRange | null {
  if (!rangeHeader || size <= 0) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;

  if (startRaw === "") {
    // 后缀范围：bytes=-N 表示最后 N 个字节
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;
  const requestedEnd = endRaw === "" ? size - 1 : Number(endRaw);
  if (!Number.isFinite(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}
