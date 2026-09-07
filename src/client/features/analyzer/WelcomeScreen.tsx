import { CompanionPortrait } from "./CompanionPortrait.js";
import { Icon } from "../../shared/Icon.js";

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
  const authError = new URLSearchParams(window.location.search).get("auth");
  const callbackError = ["cancelled", "expired", "unavailable"].includes(authError || "");
  const target = window.location.pathname.startsWith("/jobs/") ? window.location.pathname : "/";
  const loginUrl = `/api/auth/github?returnTo=${encodeURIComponent(target)}`;
  return <section className="welcome-layout" aria-labelledby="welcome-title">
    <div className="welcome-main"><span className="welcome-eyebrow">{zh ? "你的视频小助手" : "YOUR VIDEO COMPANION"}</span><h1 id="welcome-title">{zh ? <>把视频交给 Koma，<br /><span>轻松看懂重点。</span></> : <>A little help with<br /><span>your next video.</span></>}</h1><p className="welcome-description">{zh ? "想学的课程、喜欢的访谈、来不及看完的视频。交给 Koma，看摘要、理清章节、搜索字幕，也能分析画面里的细节。" : "The lesson you’re learning, the interview you loved, the video you haven’t finished. Koma summarizes the ideas, maps the chapters, and analyzes speech and visuals so every moment is easy to find."}</p>
      <div className="welcome-login">{enabled && !unavailable ? <a className="primary-button github-login" href={loginUrl}><GithubMark />{zh ? "通过 GitHub 进入工作区" : "Continue with GitHub"}<Icon name="arrow-up-right" size={22} /></a> : <div className="login-unavailable"><strong>{zh ? "登录服务暂时不可用" : "Sign-in is temporarily unavailable"}</strong><button className="text-button" type="button" onClick={onRefresh}>{zh ? "重新检查" : "Check again"}<Icon name="refresh" size={15} /></button></div>}<small>{zh ? "只读取公开账号信息，不申请仓库权限。" : "Public profile only. No repository access requested."}</small></div>
      {(expired || callbackError || error) && <div className="welcome-error" role="alert">{(expired || authError === "expired") ? (zh ? "登录已过期。重新登录后，就能继续查看自己的视频。" : "Your session expired. Sign in again to return to your videos.") : authError === "unavailable" ? (zh ? "GitHub 登录暂时没有连接成功，请稍后重试。" : "GitHub sign-in could not be reached. Please try again shortly.") : callbackError ? (zh ? "这次登录没有完成，请重新通过 GitHub 登录。" : "Sign-in wasn’t completed. Please try GitHub again.") : error}</div>}
      <div className="welcome-account-note"><Icon name="corner-down-right" size={21} /><p>{zh ? "视频归你，记录也归你。换个浏览器登录，依然能找到。" : "Your videos, your analysis history. Sign in on another browser and pick up where you left off."}</p></div>
    </div>
    <aside className="welcome-aside"><div className="welcome-character"><span className="character-greeting">{zh ? "今天，一起看点什么？" : "What shall we watch today?"}</span><CompanionPortrait priority /><span className="character-signature">{zh ? "Koma，随时陪你逐帧整理。" : "Koma, your frame-by-frame friend."}</span></div></aside>
    <div className="welcome-capabilities">{(zh ? [["01", "重点，我来整理", "摘要与章节，帮助你快速了解内容和脉络。"], ["02", "想重看，马上找到", "搜索字幕，点一下就回到原片中的那一刻。"], ["03", "分析结果，都能带走", "摘要、字幕、自定义数据，下载后继续使用。"]] : [["01", "The ideas, all together", "Understand the content and its structure with summaries and chapters."], ["02", "Back to that moment", "Search a line and jump straight to where it happened."], ["03", "A little more to keep", "Download your summary, subtitles, and custom data."]]).map(([index, title, description]) => <div key={index}><span>{index}</span><div><h2>{title}</h2><p>{description}</p></div></div>)}</div>
    <footer className="welcome-footer"><span>LITTLE MOMENTS, WORTH KEEPING.</span><span>{zh ? "视频理解 · 个人资料库" : "VIDEO ANALYSIS · YOUR OWN LIBRARY"}</span></footer>
  </section>;
}
