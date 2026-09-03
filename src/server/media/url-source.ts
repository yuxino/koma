const browserUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const DOUYIN_HOST_SUFFIXES = ["douyin.com", "douyinvod.com", "iesdouyin.com", "snssdk.com", "amemv.com"];
const BILIBILI_HOST_SUFFIXES = ["bilibili.com", "b23.tv", "bilivideo.com", "hdslb.com"];

export function normalizeVideoUrl(value: string): string {
  const normalized = value.trim();
  if (normalized.startsWith("//")) return `https:${normalized}`;
  if (!/^[a-z][a-z\d+.-]*:/i.test(normalized) && /^[^/\s]+\.[^/\s]+/.test(normalized)) {
    return `https://${normalized}`;
  }
  return normalized;
}

export function headersForVideoUrl(value: string): Record<string, string> {
  const parsed = new URL(value);
  const headers: Record<string, string> = {
    accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
    "user-agent": browserUserAgent,
    "cache-control": "no-cache"
  };
  if (isDouyinHost(parsed.hostname)) {
    headers.referer = "https://www.douyin.com/";
    headers.origin = "https://www.douyin.com";
  }
  if (isBilibiliHost(parsed.hostname)) {
    headers.referer = "https://www.bilibili.com/";
  }
  return headers;
}

function matchesSuffix(hostname: string, suffixes: string[]): boolean {
  const normalized = hostname.toLowerCase();
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`));
}

export function isDouyinHost(hostname: string): boolean {
  return matchesSuffix(hostname, DOUYIN_HOST_SUFFIXES);
}

export function isBilibiliHost(hostname: string): boolean {
  return matchesSuffix(hostname, BILIBILI_HOST_SUFFIXES);
}
