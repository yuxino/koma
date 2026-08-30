import { spawn, spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";
import { isBilibiliHost, isDouyinHost } from "./url-source.js";

const douyinPageUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const browserLikeUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

export interface ResolvedVideo {
  url: string;
  title?: string;
  source: "douyin" | "bilibili" | "ytdlp" | "direct";
  referer?: string;
}

interface ResolveOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  /** 抖音解析时附加的 cookie（调试/测试用）；缺省时自动获取 ttwid */
  cookie?: string;
}

const defaultOptions: Required<Omit<ResolveOptions, "signal" | "cookie">> = {
  fetchImpl: fetch,
  timeoutMs: 30_000,
  maxRedirects: 6
};

// ttwid 是抖音种在浏览器里的匿名追踪 cookie，免登录注册一次可用很久。
// 2025 年起抖音分享页对无 cookie 的请求直接返回风控页（_ROUTER_DATA 里没有视频数据），
// 带上 ttwid 后分享页才会正常返回 videoInfoRes。
let ttwidCache: { cookie: string; expiresAt: number } | null = null;

// 注册并返回 ttwid cookie；纯函数（无缓存），便于测试。失败时返回 undefined。
export async function fetchTtwidCookie(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl("https://ttwid.bytedance.com/ttwid/union/register/", {
      method: "POST",
      headers: {
        "user-agent": douyinPageUserAgent,
        "content-type": "application/json",
        referer: "https://www.douyin.com/"
      },
      body: JSON.stringify({
        region: "cn",
        aid: 1768,
        needFid: false,
        service: "www.ixigua.com",
        migrate: { info: "", source: "node" }
      }),
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json().catch(() => ({})) as { redirect_url?: string };
    if (!body.redirect_url) return undefined;
    const callback = await fetchImpl(body.redirect_url, {
      redirect: "manual",
      headers: { "user-agent": douyinPageUserAgent },
      signal: AbortSignal.timeout(15_000)
    });
    // 回调响应通过 set-cookie 下发 ttwid；旧版 undici 没有 getSetCookie 时退回 set-cookie 头
    const rawCookies = typeof callback.headers.getSetCookie === "function"
      ? callback.headers.getSetCookie()
      : (callback.headers.get("set-cookie") ? [callback.headers.get("set-cookie")!] : []);
    const ttwid = rawCookies.map((item) => item.split(";")[0]).find((item) => item.startsWith("ttwid="));
    if (!ttwid) return undefined;
    return ttwid;
  } catch {
    return undefined;
  }
}

// 带缓存的 ttwid 获取：注册一次后复用直到过期。
// ttwid 形如 ttwid=1%7C<value>%7C<过期秒级时间戳>%7C<签名>，第三段是过期时间。
async function getTtwidCookie(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  if (ttwidCache && Date.now() < ttwidCache.expiresAt) return ttwidCache.cookie;
  const ttwid = await fetchTtwidCookie(fetchImpl);
  if (!ttwid) return undefined;
  const expirySeconds = Number(decodeURIComponent(ttwid).split("|")[2]);
  ttwidCache = {
    cookie: ttwid,
    expiresAt: Number.isFinite(expirySeconds) && expirySeconds > 0 ? expirySeconds * 1000 : Date.now() + 6 * 3600 * 1000
  };
  return ttwid;
}

// 从分享文案里挑出第一条 http(s) 链接，例如抖音的
// “8.88 复制打开抖音… https://v.douyin.com/xxxx/”。
export function extractUrlFromText(value: unknown): string {
  if (typeof value !== "string") return "";
  const match = value.match(/https?:\/\/[^\s<>"'，。；、！？）\]】]+/i);
  if (!match) return "";
  return match[0].replace(/[),.;，。；！!、）\]】]+$/g, "");
}

// 把 _ROUTER_DATA 里的播放地址里 playwm（带水印）换成 play（无水印）。
export function deWatermark(url: string): string {
  return url.replace("/playwm/", "/play/");
}

export function looksLikeDouyinLink(value: string): boolean {
  try {
    return isDouyinHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

// 从抖音链接里提取视频 ID 并转成分享页地址：
// - www.douyin.com/jingxuan/search/...?modal_id=<id>（精选/搜索弹窗）
// - www.douyin.com/video/<id>、www.iesdouyin.com/share/video/<id>
// 分享页是服务端渲染，HTML 里带 _ROUTER_DATA，解析最稳。
export function douyinShareUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!isDouyinHost(parsed.hostname)) return null;
    const modal = parsed.searchParams.get("modal_id");
    if (modal && /^\d+$/.test(modal)) return `https://www.iesdouyin.com/share/video/${modal}`;
    const pathMatch = parsed.pathname.match(/^\/(?:video|share\/video)\/(\d+)/);
    if (pathMatch) return `https://www.iesdouyin.com/share/video/${pathMatch[1]}`;
  } catch {
    // 不是合法 URL 就交给后续逻辑
  }
  return null;
}

// 解析抖音分享页。返回 { url, title } 或 null。
export function parseDouyinPage(html: string): { url: string; title?: string } | null {
  const routerJson = extractRouterData(html);
  if (routerJson) {
    try {
      const found = findVideoInRouterData(JSON.parse(routerJson) as RouterData);
      if (found) return found;
    } catch {
      // 继续尝试 og:video
    }
  }
  const ogVideo = extractOgVideo(html);
  if (ogVideo) return { url: deWatermark(ogVideo), title: undefined };
  return null;
}

export async function resolveDouyinVideo(value: string, options: ResolveOptions = {}): Promise<ResolvedVideo> {
  const { fetchImpl, timeoutMs, maxRedirects, signal } = { ...defaultOptions, ...options };
  // 抖音分享页现在要求 cookie 才会返回视频数据（否则是风控页）。
  // 先拿 ttwid 匿名 cookie；拿不到就退回无 cookie 请求，让错误信息落到后面的解析失败。
  const cookie = options.cookie ?? await getTtwidCookie(fetchImpl).catch(() => undefined);
  const headers: Record<string, string> = {
    "user-agent": douyinPageUserAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9",
    referer: "https://www.douyin.com/"
  };
  if (cookie) headers.cookie = cookie;
  let current = douyinShareUrl(value) || value;
  for (let attempt = 0; attempt < maxRedirects; attempt += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers,
      signal: combineSignals(signal, timeoutMs)
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`抖音页面无法访问：${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("video/") || contentType.includes("audio/")) {
      return { url: current, source: "douyin", title: undefined, referer: "https://www.douyin.com/" };
    }
    const html = await response.text();
    const parsed = parseDouyinPage(html);
    if (parsed) return { ...parsed, source: "douyin", referer: "https://www.douyin.com/" };
    throw new Error("抖音这条内容没有解析到视频（可能是图文笔记、已删除或需要登录）。");
  }
  throw new Error("抖音链接重定向次数太多，暂时解析不了。");
}

// B 站原生解析：官方接口拿视频信息（标题、cid）和播放直链，不需要登录。
// b23.tv 短链先跟随重定向到正片地址。
export async function resolveBilibiliVideo(value: string, options: ResolveOptions = {}): Promise<ResolvedVideo> {
  const { fetchImpl, timeoutMs, signal } = { ...defaultOptions, ...options };
  const headers = {
    "user-agent": browserLikeUserAgent,
    referer: "https://www.bilibili.com/",
    accept: "application/json,text/plain,*/*"
  };
  let url = value;
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "b23.tv" || hostname.endsWith(".b23.tv")) {
    const redirected = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": browserLikeUserAgent },
      signal: combineSignals(signal, timeoutMs)
    });
    url = redirected.url || url;
  }
  const bvid = bilibiliBvid(url);
  if (!bvid) throw new Error("没有从 B 站链接里找到视频编号。");

  const viewResponse = await fetchImpl(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    headers,
    signal: combineSignals(signal, timeoutMs)
  });
  const viewBody = await viewResponse.json().catch(() => ({})) as BilibiliViewResponse;
  if (viewBody.code !== 0) throw new Error(`B 站视频信息获取失败：${viewBody.message || viewBody.code}`);
  const data = viewBody.data || {};
  const cid = data.cid ?? data.pages?.[0]?.cid;
  if (!cid) throw new Error("B 站这条内容没有可用的分P编号。");

  const playResponse = await fetchImpl(`https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=1`, {
    headers,
    signal: combineSignals(signal, timeoutMs)
  });
  const playBody = await playResponse.json().catch(() => ({})) as BilibiliPlayResponse;
  if (playBody.code !== 0) throw new Error(`B 站播放地址获取失败：${playBody.message || playBody.code}`);
  const direct = playBody.data?.durl?.[0]?.url;
  if (!direct) throw new Error("B 站没有返回可下载的播放地址（可能需要登录）。");

  return { url: direct, title: typeof data.title === "string" ? data.title : undefined, source: "bilibili", referer: "https://www.bilibili.com/" };
}

export function looksLikeBilibiliLink(value: string): boolean {
  try {
    return isBilibiliHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

// 从 B 站链接里提取 BV 号：/video/BVxxx 路径或 bvid= 参数都行。
export function bilibiliBvid(value: string): string | null {
  try {
    const parsed = new URL(value);
    const fromQuery = parsed.searchParams.get("bvid");
    if (fromQuery && /^BV[0-9A-Za-z]{10,}$/.test(fromQuery)) return fromQuery;
    const match = parsed.pathname.match(/(BV[0-9A-Za-z]{10,})/);
    if (match) return match[1];
  } catch {
    // 交给外层报错
  }
  return null;
}

// 统一入口：能解析出真实可下载地址就返回它，否则原样返回让下载流程兜底。
export async function resolveVideoUrl(value: string, options: ResolveOptions = {}): Promise<ResolvedVideo> {
  if (looksLikeDouyinLink(value)) {
    try {
      return await resolveDouyinVideo(value, options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (String(error instanceof Error ? error.message : "").startsWith("抖音")) throw error;
      return { url: value, source: "direct", title: undefined };
    }
  }
  if (looksLikeBilibiliLink(value)) {
    try {
      return await resolveBilibiliVideo(value, options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("B 站") || message.includes("BV")) throw error;
      return { url: value, source: "direct", title: undefined };
    }
  }
  const ytdlpUrl = await resolveWithYtDlp(value);
  if (ytdlpUrl) return { url: ytdlpUrl, source: "ytdlp", title: undefined };
  return { url: value, source: "direct", title: undefined };
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}

// yt-dlp 兜底：覆盖抖音/B站之外的其他站点（YouTube、小红书、微博等）。
export async function resolveWithYtDlp(value: string, options: YtDlpResolveOptions = {}): Promise<string | null> {
  const commands = options.commands ?? findYtDlpCommands();
  const runImpl = options.runImpl ?? runYtDlp;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const deadline = Date.now() + timeoutMs;
  for (const command of commands) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const args = [
      ...command.args,
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "15",
      "-f",
      "best[ext=mp4]/best",
      "-g",
      value
    ];
    const { stdout } = await runImpl(command.bin, args, remainingMs);
    const lines = String(stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const direct = lines[lines.length - 1];
    if (direct && /^https?:\/\//i.test(direct)) return direct;
  }
  return null;
}

export interface YtDlpCommand {
  bin: string;
  args: string[];
}

interface CommandLookupResult {
  status: number | null;
  stdout?: string | Buffer | null;
}

type CommandLookupSpawn = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    env: NodeJS.ProcessEnv;
    shell: false;
    windowsHide: true;
  }
) => CommandLookupResult;

export interface CommandLookupOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawnSyncImpl?: CommandLookupSpawn;
}

export interface YtDlpCommandLookupOptions extends CommandLookupOptions {
  findOnPathImpl?: (name: string) => string | null;
}

export interface YtDlpResolveOptions {
  commands?: readonly YtDlpCommand[];
  runImpl?: (bin: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
  timeoutMs?: number;
}

const defaultWindowsPathExt = [".COM", ".EXE", ".BAT", ".CMD"];
const safeCommandName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function findYtDlpCommands(options: YtDlpCommandLookupOptions = {}): YtDlpCommand[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const findImpl = options.findOnPathImpl ?? ((name: string) => findOnPath(name, {
    platform,
    env,
    spawnSyncImpl: options.spawnSyncImpl
  }));
  const commands: YtDlpCommand[] = [];
  const configured = env.YTDLP_PATH?.trim();
  if (configured && !configured.includes("\0")) commands.push({ bin: configured, args: [] });

  const binaryNames = platform === "win32" ? ["yt-dlp.exe", "yt-dlp"] : ["yt-dlp"];
  for (const name of binaryNames) {
    const found = findImpl(name);
    if (found) commands.push({ bin: found, args: [] });
  }

  const pythonNames = platform === "win32" ? ["python3", "python", "py"] : ["python3", "python"];
  for (const name of pythonNames) {
    const found = findImpl(name);
    if (!found) continue;
    commands.push({
      bin: found,
      args: name === "py" ? ["-3", "-m", "yt_dlp"] : ["-m", "yt_dlp"]
    });
  }

  const seen = new Set<string>();
  return commands.filter((command) => {
    const bin = platform === "win32" ? command.bin.toLowerCase() : command.bin;
    const key = `${bin}\0${command.args.join("\0")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findOnPath(name: string, options: CommandLookupOptions = {}): string | null {
  if (!safeCommandName.test(name)) return null;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const locator = platform === "win32" ? "where.exe" : "which";
  const spawnOptions = {
    encoding: "utf8" as const,
    env,
    shell: false as const,
    windowsHide: true as const
  };
  try {
    const result = options.spawnSyncImpl
      ? options.spawnSyncImpl(locator, [name], spawnOptions)
      : spawnSync(locator, [name], spawnOptions);
    if (result.status !== 0) return null;
    const pathApi = platform === "win32" ? win32 : posix;
    const expectedNames = commandBasenames(name, platform, env);
    const found = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^"(.*)"$/, "$1"))
      .find((line) => {
        if (!pathApi.isAbsolute(line)) return false;
        const basename = pathApi.basename(line);
        const normalized = platform === "win32" ? basename.toLowerCase() : basename;
        return expectedNames.has(normalized);
      });
    return found || null;
  } catch {
    return null;
  }
}

function commandBasenames(name: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Set<string> {
  if (platform !== "win32") return new Set([name]);
  const normalizedName = name.toLowerCase();
  const result = new Set([normalizedName]);
  if (win32.extname(name)) return result;
  for (const extension of windowsPathExtensions(env)) {
    result.add(`${normalizedName}${extension.toLowerCase()}`);
  }
  return result;
}

function windowsPathExtensions(env: NodeJS.ProcessEnv): string[] {
  const configured = Object.entries(env).find(([key]) => key.toUpperCase() === "PATHEXT")?.[1];
  const extensions = (configured ? configured.split(";") : defaultWindowsPathExt)
    .map((extension) => extension.trim())
    .filter((extension) => /^\.[A-Za-z0-9]+$/.test(extension));
  return extensions.length > 0 ? [...new Set(extensions.map((extension) => extension.toUpperCase()))] : defaultWindowsPathExt;
}

function runYtDlp(bin: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", () => { clearTimeout(timer); resolve({ stdout: "", stderr: "" }); });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}

interface RouterData {
  loaderData?: Record<string, { videoInfoRes?: { item_list?: Array<RouterItem> } }>;
}

interface RouterItem {
  desc?: string;
  video?: {
    play_addr?: { url_list?: string[] };
    bit_rate?: Array<{ play_addr?: { url_list?: string[] } }>;
    download_addr?: { url_list?: string[] };
  };
}

function extractRouterData(html: string): string | null {
  const marker = "window._ROUTER_DATA";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const equals = html.indexOf("=", start);
  if (equals < 0) return null;
  const jsonStart = html.indexOf("{", equals);
  if (jsonStart < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(jsonStart, index + 1);
    }
  }
  return null;
}

function findVideoInRouterData(data: RouterData): { url: string; title?: string } | null {
  const loader = data?.loaderData || {};
  for (const value of Object.values(loader)) {
    const item = value?.videoInfoRes?.item_list?.[0];
    if (!item?.video) continue;
    const video = item.video;
    const candidate =
      video.play_addr?.url_list?.[0] ||
      video.bit_rate?.[0]?.play_addr?.url_list?.[0] ||
      video.download_addr?.url_list?.[0];
    if (!candidate) continue;
    return {
      url: deWatermark(candidate),
      title: typeof item.desc === "string" ? item.desc : undefined
    };
  }
  return null;
}

function extractOgVideo(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

interface BilibiliViewResponse {
  code: number;
  message?: string;
  data?: {
    title?: string;
    cid?: number;
    pages?: Array<{ cid: number }>;
  };
}

interface BilibiliPlayResponse {
  code: number;
  message?: string;
  data?: {
    durl?: Array<{ url: string }>;
  };
}
