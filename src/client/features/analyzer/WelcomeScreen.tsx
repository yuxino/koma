import { CompanionPortrait } from "./CompanionPortrait.js";
import { useEffect, useState } from "react";
import { Icon } from "../../shared/Icon.js";
import { publicPath, REPOSITORY_URL } from "../../shared/public-site.js";

export function GithubMark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.4-1.3-5.4-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11.1 11.1 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.4 5.9.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.1 11.1 0 0 0 12 .9Z" /></svg>;
}

export function WelcomeScreen({ language, enabled, unavailable, expired, error, onRefresh }: {
  language: "en" | "zh";
  enabled: boolean;
  unavailable: boolean;
  expired: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const zh = language === "zh";
  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => { setAuthError(new URLSearchParams(window.location.search).get("auth")); }, []);
  const callbackError = ["cancelled", "expired", "unavailable"].includes(authError || "");
  const target = typeof window !== "undefined" && window.location.pathname.startsWith("/jobs/") ? window.location.pathname : publicPath(language);
  const loginUrl = `/api/auth/github?returnTo=${encodeURIComponent(target)}`;
  return <section className="welcome-layout" aria-labelledby="welcome-title">
    <div className="welcome-main"><span className="welcome-eyebrow">{zh ? "你的视频小助手" : "YOUR VIDEO COMPANION"}</span><h1 id="welcome-title">{zh ? <>把视频交给 Koma，<br /><span>轻松看懂重点。</span></> : <>A little help with<br /><span>your next video.</span></>}</h1><p className="welcome-description">{zh ? "想学的课程、喜欢的访谈、来不及看完的视频。交给 Koma，看摘要、理清章节、搜索字幕，也能分析画面里的细节。" : "The lesson you’re learning, the interview you loved, the video you haven’t finished. Koma summarizes the ideas, maps the chapters, and analyzes speech and visuals so every moment is easy to find."}</p>
      <div className="welcome-login">{enabled && !unavailable ? <a className="primary-button github-login" href={loginUrl}><GithubMark />{zh ? "通过 GitHub 进入工作区" : "Continue with GitHub"}<Icon name="arrow-up-right" size={22} /></a> : <div className="login-unavailable"><strong>{zh ? "登录服务暂时不可用" : "Sign-in is temporarily unavailable"}</strong><button className="text-button" type="button" onClick={onRefresh}>{zh ? "重新检查" : "Check again"}<Icon name="refresh" size={15} /></button></div>}<small>{zh ? "只读取公开账号信息，不申请仓库权限。" : "Public profile only. No repository access requested."}</small></div>
      {(expired || callbackError || error) && <div className="welcome-error" role="alert">{(expired || authError === "expired") ? (zh ? "登录已过期。重新登录后，就能继续查看自己的视频。" : "Your session expired. Sign in again to return to your videos.") : authError === "unavailable" ? (zh ? "GitHub 登录暂时没有连接成功，请稍后重试。" : "GitHub sign-in could not be reached. Please try again shortly.") : callbackError ? (zh ? "这次登录没有完成，请重新通过 GitHub 登录。" : "Sign-in wasn’t completed. Please try GitHub again.") : error}</div>}
      <div className="welcome-account-note"><Icon name="corner-down-right" size={21} /><p>{zh ? "视频归你，记录也归你。换个浏览器登录，依然能找到。" : "Your videos, your analysis history. Sign in on another browser and pick up where you left off."}</p></div>
    </div>
    <aside className="welcome-aside"><div className="welcome-character"><span className="character-greeting">{zh ? "今天，一起看点什么？" : "What shall we watch today?"}</span><CompanionPortrait priority /><span className="character-signature">{zh ? "Koma，随时陪你逐帧整理。" : "Koma, your frame-by-frame friend."}</span></div></aside>
    <div className="welcome-capabilities">{(zh ? [["01", "重点，我来整理", "摘要与章节，帮助你快速了解内容和脉络。"], ["02", "想重看，马上找到", "搜索字幕，点一下就回到原片中的那一刻。"], ["03", "分析结果，都能带走", "摘要、字幕、自定义数据，下载后继续使用。"]] : [["01", "The ideas, all together", "Understand the content and its structure with summaries and chapters."], ["02", "Back to that moment", "Search a line and jump straight to where it happened."], ["03", "A little more to keep", "Download your summary, subtitles, and custom data."]]).map(([index, title, description]) => <div key={index}><span>{index}</span><div><h2>{title}</h2><p>{description}</p></div></div>)}</div>
    <div className="welcome-details">
      <section><h2>{zh ? "在浏览器里分析视频" : "Video analysis in your browser"}</h2><p>{zh ? "Koma 是可自行部署的 AI 视频分析网站。通过 GitHub 登录后，上传本地视频或粘贴公开视频链接，把语音和关键帧整理成摘要、章节、字幕与自定义数据。使用在线工作区需要 JavaScript，无需安装桌面应用。" : "Koma is a self-hosted AI video analysis website. Sign in with GitHub, upload a video or paste a public video link, and turn speech and key frames into summaries, chapters, subtitles, and custom data. The online workspace needs JavaScript; no desktop app is required."}</p></section>
      <section><h2>{zh ? "回到原片，带走结果" : "Revisit the source, export the result"}</h2><p>{zh ? "搜索字幕，或点击章节、标签与关键帧，跳回原片对应时刻。可以导出 Markdown 分析和 SRT 字幕，也能在分析前描述需要的字段，检查生成的 JSON 结构，再提取数据。AI 输出可能有误，请对照原片核实。" : "Search the transcript or select a chapter, tag, or key frame to jump to the original moment. Export Markdown analysis and SRT subtitles, or describe the fields you need and review their JSON structure before extraction. AI output can be inaccurate; check it against the source video."}</p></section>
      <section><h2>{zh ? "视频与数据如何处理" : "How videos and data are handled"}</h2><p>{zh ? "音频会发送给配置的语音服务，关键帧和字幕上下文会发送给视觉服务。视频与分析结果保留到本人或管理员删除；新建账号任务会检查所有者权限。已签发的下载链接在到期前仍可被持有者使用。" : "Audio is sent to the configured speech provider; key frames and transcript context are sent to the configured vision provider. Videos and results stay stored until their owner or an administrator deletes them. New account-owned jobs check ownership; issued signed download links remain usable by their holder until expiry."}</p><a href={`${REPOSITORY_URL}/blob/main/${zh ? "README.zh-CN.md" : "README.md"}#${zh ? "数据与隐私" : "data-and-privacy"}`}>{zh ? "数据与隐私说明" : "Data and privacy details"}</a></section>
      <section><h2>{zh ? "自行部署与使用限制" : "Self-hosting and limits"}</h2><p>{zh ? "自行部署需要 Node.js 22.13 或更新版本，并配置 GitHub 登录、语音与视觉服务；未配置模型服务时使用模拟输出。上传默认限 500 MB、15 分钟，实际以站点配置为准。需要登录或订阅的视频不支持，部分链接依赖 yt-dlp 和原网站的可用性。" : "Self-hosting requires Node.js 22.13 or newer, GitHub sign-in, and speech and vision providers. Unconfigured providers produce mock output. Uploads default to 500 MB and 15 minutes, subject to the site's settings. Login-only and subscription videos are unsupported; some links depend on yt-dlp and the source site's availability."}</p><a href={`${REPOSITORY_URL}/blob/main/${zh ? "README.zh-CN.md" : "README.md"}`}>{zh ? "源码与部署指南" : "Source and setup guide"}</a></section>
    </div>
    <footer className="welcome-footer"><span>LITTLE MOMENTS, WORTH KEEPING.</span><span>{zh ? "视频理解 · 个人资料库" : "VIDEO ANALYSIS · YOUR OWN LIBRARY"}</span></footer>
  </section>;
}
