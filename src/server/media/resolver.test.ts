import { describe, expect, it, vi } from "vitest";
import {
  bilibiliBvid,
  deWatermark,
  douyinShareUrl,
  extractUrlFromText,
  fetchTtwidCookie,
  findOnPath,
  findYtDlpCommands,
  looksLikeBilibiliLink,
  looksLikeDouyinLink,
  parseDouyinPage,
  resolveBilibiliVideo,
  resolveDouyinVideo,
  resolveWithYtDlp
} from "./resolver.js";

describe("extractUrlFromText", () => {
  it("pulls the first URL out of Douyin share copy text", () => {
    const text = "8.88 复制打开抖音，看看【作者的作品】 https://v.douyin.com/_2ljF4AmKL8/ 复制此链接，打开Dou音搜索";
    expect(extractUrlFromText(text)).toBe("https://v.douyin.com/_2ljF4AmKL8/");
  });

  it("strips trailing punctuation after a URL", () => {
    expect(extractUrlFromText("看这个 https://v.douyin.com/abc/！")).toBe("https://v.douyin.com/abc/");
    expect(extractUrlFromText("（https://v.douyin.com/abc/）")).toBe("https://v.douyin.com/abc/");
  });

  it("returns empty when there is no URL", () => {
    expect(extractUrlFromText("没有链接")).toBe("");
    expect(extractUrlFromText(undefined)).toBe("");
    expect(extractUrlFromText(123)).toBe("");
  });
});

describe("deWatermark", () => {
  it("replaces playwm with play to remove the watermark", () => {
    const url = "https://aweme.snssdk.com/aweme/v1/playwm/?video_id=abc&ratio=720p";
    expect(deWatermark(url)).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=abc&ratio=720p");
  });

  it("leaves non-playwm URLs untouched", () => {
    const url = "https://cdn.example.com/video.mp4";
    expect(deWatermark(url)).toBe(url);
  });
});

describe("looksLikeDouyinLink", () => {
  it("recognizes short links and share pages", () => {
    expect(looksLikeDouyinLink("https://v.douyin.com/abc/")).toBe(true);
    expect(looksLikeDouyinLink("https://www.iesdouyin.com/share/video/123")).toBe(true);
    expect(looksLikeDouyinLink("https://www.douyin.com/video/123")).toBe(true);
  });

  it("rejects other hosts", () => {
    expect(looksLikeDouyinLink("https://www.bilibili.com/video/BV1xx")).toBe(false);
    expect(looksLikeDouyinLink("not a url")).toBe(false);
  });
});

describe("douyinShareUrl", () => {
  it("normalizes jingxuan/search modal_id links to the share page", () => {
    const url = "https://www.douyin.com/jingxuan/search/%E6%8A%BD%E8%B1%A1%E8%A7%86%E9%A2%91?aid=abc&modal_id=7625447143519604002&type=general";
    expect(douyinShareUrl(url)).toBe("https://www.iesdouyin.com/share/video/7625447143519604002");
  });

  it("normalizes video and share/video paths to the share page", () => {
    expect(douyinShareUrl("https://www.douyin.com/video/123456")).toBe("https://www.iesdouyin.com/share/video/123456");
    expect(douyinShareUrl("https://www.iesdouyin.com/share/video/123456")).toBe("https://www.iesdouyin.com/share/video/123456");
  });

  it("returns null for short links, notes and non-Douyin hosts", () => {
    expect(douyinShareUrl("https://v.douyin.com/abc/")).toBeNull();
    expect(douyinShareUrl("https://www.douyin.com/note/123")).toBeNull();
    expect(douyinShareUrl("https://www.bilibili.com/video/BV1xx")).toBeNull();
  });
});

describe("bilibili", () => {
  it("recognizes bilibili pages, short links and CDN hosts", () => {
    expect(looksLikeBilibiliLink("https://www.bilibili.com/video/BV1ShuW6rEcT/?spm=1")).toBe(true);
    expect(looksLikeBilibiliLink("https://b23.tv/abc123")).toBe(true);
    expect(looksLikeBilibiliLink("https://upos-sz-estgoss.bilivideo.com/video.mp4")).toBe(true);
    expect(looksLikeBilibiliLink("https://www.douyin.com/video/1")).toBe(false);
  });

  it("extracts the BV id from paths and query params", () => {
    expect(bilibiliBvid("https://www.bilibili.com/video/BV1ShuW6rEcT/?spm_id_from=333")).toBe("BV1ShuW6rEcT");
    expect(bilibiliBvid("https://www.bilibili.com/video?bvid=BV1xx411c7mD")).toBe("BV1xx411c7mD");
    expect(bilibiliBvid("https://b23.tv/abc")).toBeNull();
  });

  it("resolves a bilibili video to its direct mp4 via the official APIs", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/x/web-interface/view")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { title: "测试视频标题", cid: 12345, pages: [{ cid: 12345, page: 1 }] }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/x/player/playurl")) {
        return new Response(JSON.stringify({
          code: 0,
          data: { durl: [{ url: "https://upos-sz-estgoss.bilivideo.com/video.mp4?e=123" }] }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected url ${url}`);
    };
    const resolved = await resolveBilibiliVideo("https://www.bilibili.com/video/BV1ShuW6rEcT/", { fetchImpl });
    expect(resolved.source).toBe("bilibili");
    expect(resolved.title).toBe("测试视频标题");
    expect(resolved.url).toBe("https://upos-sz-estgoss.bilivideo.com/video.mp4?e=123");
  });

  it("surfaces a readable error when the video info call fails", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ code: -404, message: "啥都木有" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
    await expect(resolveBilibiliVideo("https://www.bilibili.com/video/BV1ShuW6rEcT/", { fetchImpl }))
      .rejects.toThrow(/B 站/);
  });
});

describe("parseDouyinPage", () => {
  const routerJson = JSON.stringify({
    loaderData: {
      "video_(id)/page": {
        videoInfoRes: {
          item_list: [
            {
              desc: "一段测试视频",
              video: {
                play_addr: {
                  url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v1&ratio=720p&line=0"]
                },
                bit_rate: []
              }
            }
          ]
        }
      }
    }
  });

  it("extracts the no-watermark play URL and title from _ROUTER_DATA", () => {
    const html = `<html><head></head><body><script>window._ROUTER_DATA = ${routerJson}</script></body></html>`;
    const parsed = parseDouyinPage(html);
    expect(parsed).not.toBeNull();
    expect(parsed.url).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=v1&ratio=720p&line=0");
    expect(parsed.title).toBe("一段测试视频");
  });

  it("falls back to the og:video meta tag", () => {
    const html = '<meta property="og:video" content="https://aweme.snssdk.com/aweme/v1/playwm/?video_id=og1" />';
    expect(parseDouyinPage(html).url).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=og1");
  });

  it("returns null when no video is present", () => {
    expect(parseDouyinPage("<html>nothing here</html>")).toBeNull();
  });
});

describe("resolveDouyinVideo", () => {
  it("follows redirects and resolves the real video URL", async () => {
    const routerJson = JSON.stringify({
      loaderData: {
        "video_(id)/page": {
          videoInfoRes: {
            item_list: [
              {
                desc: "标题",
                video: {
                  play_addr: {
                    url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=v1"]
                  }
                }
              }
            ]
          }
        }
      }
    });
    const fetchImpl = async (url, init) => {
      if (url === "https://v.douyin.com/abc/") {
        return {
          ok: true,
          status: 302,
          headers: new Headers({ location: "https://www.iesdouyin.com/share/video/123" }),
          text: async () => ""
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => `<script>window._ROUTER_DATA = ${routerJson}</script>`
      };
    };
    const resolved = await resolveDouyinVideo("https://v.douyin.com/abc/", { fetchImpl, cookie: "ttwid=test" });
    expect(resolved.url).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=v1");
    expect(resolved.title).toBe("标题");
    expect(resolved.source).toBe("douyin");
  });

  it("resolves jingxuan/search modal_id links via the share page", async () => {
    const routerJson = JSON.stringify({
      loaderData: {
        "video_(id)/page": {
          videoInfoRes: {
            item_list: [
              {
                desc: "弹窗视频标题",
                video: {
                  play_addr: { url_list: ["https://aweme.snssdk.com/aweme/v1/playwm/?video_id=modal1"] }
                }
              }
            ]
          }
        }
      }
    });
    const fetched = [];
    const fetchImpl = async (url) => {
      fetched.push(url);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => `<script>window._ROUTER_DATA = ${routerJson}</script>`
      };
    };
    const link = "https://www.douyin.com/jingxuan/search/x?modal_id=7625447143519604002";
    const resolved = await resolveDouyinVideo(link, { fetchImpl, cookie: "ttwid=test" });
    expect(fetched[0]).toBe("https://www.iesdouyin.com/share/video/7625447143519604002");
    expect(resolved.url).toBe("https://aweme.snssdk.com/aweme/v1/play/?video_id=modal1");
    expect(resolved.title).toBe("弹窗视频标题");
  });

  it("returns the URL directly when the response is already media", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "video/mp4" }),
      text: async () => "binary"
    });
    const resolved = await resolveDouyinVideo("https://v3-web.douyinvod.com/video.mp4", { fetchImpl, cookie: "ttwid=test" });
    expect(resolved.url).toBe("https://v3-web.douyinvod.com/video.mp4");
  });

  it("throws a readable error when the page has no video", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<html>no data</html>"
    });
    await expect(resolveDouyinVideo("https://www.douyin.com/note/123", { fetchImpl, cookie: "ttwid=test" }))
      .rejects.toThrow(/图文笔记|已删除|登录/);
  });
});

describe("fetchTtwidCookie", () => {
  it("registers a ttwid and returns the cookie from the callback set-cookie", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url.includes("/ttwid/union/register/") && !url.includes("/callback/")) {
        return new Response(JSON.stringify({
          status_code: 0,
          message: "union register success",
          redirect_url: "https://www.ixigua.com/ttwid/union/register/callback/?ticket=abc"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(null, {
        status: 200,
        headers: { "set-cookie": "ttwid=1%7Cvalue%7C9999999999%7Csig; path=/; max-age=31536000" }
      });
    };

    const cookie = await fetchTtwidCookie(fetchImpl);
    expect(cookie).toBe("ttwid=1%7Cvalue%7C9999999999%7Csig");
    expect(calls[0]).toContain("/ttwid/union/register/");
    expect(calls[1]).toContain("/callback/");
  });

  it("returns undefined when registration has no redirect_url", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ status_code: -1 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
    expect(await fetchTtwidCookie(fetchImpl)).toBeUndefined();
  });

  it("returns undefined when the callback sets no ttwid cookie", async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ redirect_url: "https://example.com/callback" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(null, { status: 200, headers: { "set-cookie": "other=1" } });
    };
    expect(await fetchTtwidCookie(fetchImpl)).toBeUndefined();
  });

  it("survives network errors with undefined instead of throwing", async () => {
    const fetchImpl = async () => { throw new Error("network down"); };
    expect(await fetchTtwidCookie(fetchImpl)).toBeUndefined();
  });

  it("passes the cookie into the share page request when provided", async () => {
    const seenCookies: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seenCookies.push(String(init?.headers && (init.headers as Record<string, string>).cookie || ""));
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html>no data</html>"
      };
    };
    await expect(resolveDouyinVideo("https://v.douyin.com/x/", { fetchImpl, cookie: "ttwid=custom" }))
      .rejects.toThrow(/图文笔记|已删除|登录/);
    expect(seenCookies.every((cookie) => cookie === "ttwid=custom")).toBe(true);
  });
});

describe("yt-dlp command discovery", () => {
  it("uses where.exe and PATHEXT on Windows", () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stdout: "C:\\Tools\\yt-dlp.EXE\r\n"
    }));

    expect(findOnPath("yt-dlp", {
      platform: "win32",
      env: { PATH: "C:\\Tools", PATHEXT: ".COM;.EXE;.CMD" },
      spawnSyncImpl
    })).toBe("C:\\Tools\\yt-dlp.EXE");
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "where.exe",
      ["yt-dlp"],
      expect.objectContaining({ shell: false, windowsHide: true })
    );
  });

  it("uses which on non-Windows platforms", () => {
    const spawnSyncImpl = vi.fn(() => ({ status: 0, stdout: "/opt/bin/yt-dlp\n" }));

    expect(findOnPath("yt-dlp", { platform: "linux", env: {}, spawnSyncImpl })).toBe("/opt/bin/yt-dlp");
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "which",
      ["yt-dlp"],
      expect.objectContaining({ shell: false })
    );
  });

  it("rejects unsafe names, relative output and mismatched executables", () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stdout: "relative\\yt-dlp.exe\r\nC:\\Tools\\yt-dlp.txt\r\n"
    }));

    expect(findOnPath("yt-dlp & calc", { platform: "win32", env: {}, spawnSyncImpl })).toBeNull();
    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(findOnPath("yt-dlp", { platform: "win32", env: { PATHEXT: ".EXE;.CMD" }, spawnSyncImpl })).toBeNull();
  });

  it("returns Windows native and Python fallbacks in deterministic order", () => {
    const locations: Record<string, string> = {
      "yt-dlp.exe": "C:\\Tools\\yt-dlp.exe",
      "yt-dlp": "C:\\Tools\\yt-dlp.exe",
      python3: "C:\\Python313\\python3.exe",
      python: "C:\\Python313\\python.exe",
      py: "C:\\Windows\\py.exe"
    };
    const findOnPathImpl = vi.fn((name: string) => locations[name] || null);

    expect(findYtDlpCommands({
      platform: "win32",
      env: { YTDLP_PATH: "C:\\Portable\\yt-dlp.exe" },
      findOnPathImpl
    })).toEqual([
      { bin: "C:\\Portable\\yt-dlp.exe", args: [] },
      { bin: "C:\\Tools\\yt-dlp.exe", args: [] },
      { bin: "C:\\Python313\\python3.exe", args: ["-m", "yt_dlp"] },
      { bin: "C:\\Python313\\python.exe", args: ["-m", "yt_dlp"] },
      { bin: "C:\\Windows\\py.exe", args: ["-3", "-m", "yt_dlp"] }
    ]);
  });

  it("tries the next candidate when a PATH match cannot run yt-dlp", async () => {
    const commands = [
      { bin: "C:\\WindowsApps\\python3.exe", args: ["-m", "yt_dlp"] },
      { bin: "C:\\Python313\\python.exe", args: ["-m", "yt_dlp"] }
    ];
    const runImpl = vi.fn(async (bin: string) => ({
      stdout: bin.includes("WindowsApps") ? "" : "https://cdn.example/video.mp4\r\n",
      stderr: ""
    }));
    const sourceUrl = "https://example.test/watch?v=1&next=calc.exe";

    await expect(resolveWithYtDlp(sourceUrl, { commands, runImpl, timeoutMs: 500 })).resolves
      .toBe("https://cdn.example/video.mp4");
    expect(runImpl).toHaveBeenCalledTimes(2);
    expect(runImpl.mock.calls[1][1].at(-1)).toBe(sourceUrl);
  });
});
