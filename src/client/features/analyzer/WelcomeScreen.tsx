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
    <div className="welcome-main"><span className="welcome-eyebrow"><span aria-hidden="true">[ K ]</span> A LITTLE VIDEO ATELIER</span><h1 id="welcome-title">{zh ? <>看懂一段视频，<br /><span>留下有用的部分。</span></> : <>Keep the moments.<br /><span>Make sense<br />of the rest.</span></>}</h1><p className="welcome-description">{zh ? "课程、访谈、演示，或一段还没来得及看完的视频。Koma 帮你整理重点、字幕和时间点，值得细看的地方，再回到原片。" : "A lecture, an interview, a demo you haven’t finished watching. Koma brings the ideas, words, and useful moments together—so you can return to the parts that matter."}</p>
      <div className="welcome-login">{enabled && !unavailable ? <a className="primary-button github-login" href={loginUrl}><GithubMark />{zh ? "通过 GitHub 进入工作区" : "Continue with GitHub"}<Icon name="arrow-up-right" size={22} /></a> : <div className="login-unavailable"><strong>{zh ? "登录服务暂时不可用" : "Sign-in is temporarily unavailable"}</strong><button className="text-button" type="button" onClick={onRefresh}>{zh ? "重新检查" : "Check again"}<Icon name="refresh" size={15} /></button></div>}<small>{zh ? "只读取公开账号信息，不申请仓库权限。" : "Public profile only. No repository access requested."}</small></div>
      {(expired || callbackError || error) && <div className="welcome-error" role="alert">{(expired || authError === "expired") ? (zh ? "登录已过期。重新登录后，就能继续查看自己的视频。" : "Your session expired. Sign in again to return to your videos.") : authError === "unavailable" ? (zh ? "GitHub 登录暂时没有连接成功，请稍后重试。" : "GitHub sign-in could not be reached. Please try again shortly.") : callbackError ? (zh ? "这次登录没有完成，请重新通过 GitHub 登录。" : "Sign-in wasn’t completed. Please try GitHub again.") : error}</div>}
      <div className="welcome-account-note"><Icon name="corner-down-right" size={21} /><p>{zh ? "视频归你，记录也归你。换个浏览器登录，依然能找到。" : "Your videos, your notes. Sign in on another browser and pick up where you left off."}</p></div>
    </div>
    <aside className="welcome-aside"><div className="welcome-character"><span className="character-caption">KOMA · FRAME ASSISTANT</span><img src="/koma-note-girl.png" alt="" fetchPriority="high" /><div className="character-timecode"><span>REC <Icon name="dot" size={12} /></span><span>00:00:01</span></div></div><div className="welcome-capabilities">{(zh ? [["01", "先抓住重点", "摘要与章节，给长视频一条清晰的阅读路径。"], ["02", "回到那一句", "搜索字幕、点选时间码，让每个结论都有出处。"], ["03", "带走能用的内容", "下载笔记、字幕和自定义数据，接着完成你的工作。"]] : [["01", "Find the through line", "Summaries and chapters make long videos easier to follow."], ["02", "Return to the exact words", "Search the transcript and jump straight to the source."], ["03", "Take the useful parts", "Download notes, subtitles, and the data you asked for."]]).map(([index, title, description]) => <div key={index}><span>{index}</span><div><h2>{title}</h2><p>{description}</p></div></div>)}</div></aside>
    <footer className="welcome-footer"><span>FRAME BY FRAME, A LITTLE CLEARER.</span><span>{zh ? "视频理解 · 个人资料库" : "VIDEO NOTES · YOUR OWN LIBRARY"}</span></footer>
  </section>;
}
