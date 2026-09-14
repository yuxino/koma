/** Invalid remote input must never fall back to a platform/page extractor. */
export class VideoInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "VideoInputError";
  }
}

export const DIRECT_MP4_REQUIRED = "只支持可直接下载的 MP4 直链，不支持第三方平台页面、分享链接或分享文案。";

export function normalizeVideoUrl(value: string): string {
  const normalized = value.trim();
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (!/^[a-z][a-z\d+.-]*:/i.test(normalized) && /^[^/\s]+\.[^/\s]+/.test(normalized)) {
    return `https://${normalized}`;
  }
  return normalized;
}

/** Browser-safe, network-free validation, shared by the form, HTTP API and CLI. */
export function validateDirectVideoUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new VideoInputError("请输入 MP4 视频直链。");
  const normalized = normalizeVideoUrl(value);
  // Never pull a URL out of share text or silently discard control characters.
  if (/[\s\u0000-\u001f\u007f\\]/.test(normalized)) throw new VideoInputError(DIRECT_MP4_REQUIRED);
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new VideoInputError(DIRECT_MP4_REQUIRED); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new VideoInputError("只支持 http 或 https 的 MP4 视频直链。");
  if (parsed.username || parsed.password) throw new VideoInputError("MP4 直链不能包含用户名或密码。");
  if (isPrivateVideoHost(parsed.hostname)) throw new VideoInputError("不支持访问本机或内网地址。");
  let pathname: string;
  try { pathname = decodeURIComponent(parsed.pathname); } catch { throw new VideoInputError(DIRECT_MP4_REQUIRED); }
  if (!/\.mp4$/i.test(pathname)) throw new VideoInputError(DIRECT_MP4_REQUIRED);
  // URL serialization preserves signed query parameters; the suffix check only uses the path.
  return parsed.href;
}

/** Kept async so job cancellation is checked again before starting a download. No I/O. */
export async function prepareDirectVideoUrl(value: unknown, { signal }: { signal?: AbortSignal } = {}): Promise<string> {
  signal?.throwIfAborted();
  return validateDirectVideoUrl(value);
}

export function headersForVideoUrl(value: string): Record<string, string> {
  validateDirectVideoUrl(value);
  return {
    accept: "video/mp4,application/mp4,application/octet-stream;q=0.8",
    "user-agent": "Koma/0.1",
    "accept-encoding": "identity"
  };
}

// This is a literal-host guard, not DNS pinning. Public deployments still need an egress policy.
export function isPrivateVideoHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || /\.(?:localhost|local|internal)$/.test(host)) return true;
  // Accept only global-unicast IPv6 literals, excluding loopback, mapped IPv4 and link-local forms.
  if (host.includes(":")) return !/^[23][\da-f]{3}:/.test(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19));
  }
  return !host.includes(".");
}
