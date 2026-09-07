import { CompanionPortrait } from "./CompanionPortrait.js";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Icon } from "../../shared/Icon.js";
import { formatTime } from "../../shared/format.js";
import { translateServerError } from "../../shared/errors.js";
import { filterJobs } from "./workspace-utils.js";

export interface LibraryJob {
  id: string;
  title: string;
  sourceTitle?: string;
  source: "upload" | "url";
  status: "queued" | "processing" | "done" | "failed";
  progress: { stage: string; percent: number; detail: string };
  createdAt: number;
  summary?: string;
  durationMs?: number;
  error: string | null;
}

const words = {
  zh: { title: "我的视频资料库", description: "每一段视频，都有迹可循。", search: "搜索标题、文件名、摘要或失败原因", all: "全部", active: "进行中", done: "已完成", failed: "未完成", empty: "资料库还是空的。", emptyText: "从一段想看懂的视频开始，分析和字幕会保存在这里。", noMatches: "没有符合条件的视频。", clear: "清除筛选", loading: "正在读取你的资料库…", create: "分析新视频", open: "打开视频", delete: "删除", deleting: "删除中…", url: "视频链接", upload: "本地上传", reload: "重新加载", private: "仅自己可见", count: "段视频", claim: "找回旧浏览器记录", claimText: "这个浏览器还有 {count} 个未绑定的旧任务。确认后将归入当前账号，并改为仅自己可见；已下载或缓存的副本无法收回。", claimAction: "归入我的资料库", claiming: "正在归入…", preview: "查看旧任务", queued: "排队中", processing: "分析中" },
  en: { title: "Your video library", description: "Good moments deserve a place to return to.", search: "Search titles, filenames, summaries, or errors", all: "All", active: "In progress", done: "Complete", failed: "Unfinished", empty: "A little room for your next video.", emptyText: "Start with something you want to understand. Its analysis and transcript will live here.", noMatches: "No videos match these filters.", clear: "Clear filters", loading: "Loading your library…", create: "Analyze a video", open: "Open video", delete: "Delete", deleting: "Deleting…", url: "Video URL", upload: "Uploaded file", reload: "Reload", private: "Only you", count: "videos", claim: "Recover this browser’s older jobs", claimText: "This browser has {count} unclaimed jobs. Confirm to move them into this account and make them private. Previously downloaded or cached public copies cannot be recalled.", claimAction: "Move into my library", claiming: "Moving…", preview: "Review older jobs", queued: "Queued", processing: "Analyzing" }
};

export function WorkspaceLibrary({ language, onOpen, onDelete, onNew, onUnauthorized, legacyJobCount, onClaimed }: {
  language: "en" | "zh";
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  onNew: () => void;
  onUnauthorized: () => void;
  legacyJobCount: number;
  onClaimed: () => void;
}) {
  const t = words[language];
  const [jobs, setJobs] = useState<LibraryJob[]>([]);
  const [legacyJobs, setLegacyJobs] = useState<LibraryJob[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const shownJobs = useMemo(() => filterJobs(jobs, query, status), [jobs, query, status]);

  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    async function refresh(initial: boolean) {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch("/api/my/jobs", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { onUnauthorized(); return; }
        const body = await response.json() as { jobs?: LibraryJob[]; error?: string };
        if (!response.ok) throw new Error(body.error || t.reload);
        if (!controller.signal.aborted) { setJobs(body.jobs || []); setError(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language));
      } finally {
        fetching = false;
        if (initial && !controller.signal.aborted) setLoading(false);
      }
    }
    setLoading(true);
    void refresh(true);
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(false); }, 8000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [language, revision]);

  async function remove(id: string) {
    setDeletingId(id);
    try { if (await onDelete(id)) setJobs((current) => current.filter((job) => job.id !== id)); }
    catch (cause) { setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); }
    finally { setDeletingId(null); }
  }

  async function previewLegacy() {
    setError("");
    try {
      const response = await fetch("/api/my/jobs/legacy", { cache: "no-store" });
      if (response.status === 401) { onUnauthorized(); return; }
      const body = await response.json() as { jobs?: LibraryJob[]; error?: string };
      if (!response.ok) throw new Error(body.error || t.reload);
      setLegacyJobs(body.jobs || []);
    } catch (cause) { setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); }
  }

  async function claimLegacy() {
    setClaiming(true); setError("");
    try {
      const response = await fetch("/api/my/jobs/claim", { method: "POST", headers: { "X-Koma-Client": "1" } });
      if (response.status === 401) { onUnauthorized(); return; }
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || t.reload);
      setLegacyJobs(null); onClaimed(); setRevision((value) => value + 1);
    } catch (cause) { setError(translateServerError(cause instanceof Error ? cause.message : String(cause), language)); }
    finally { setClaiming(false); }
  }

  return <section className="workspace-library" aria-labelledby="library-title">
    <header className="library-heading"><div><span className="page-label">YOUR VIDEO LIBRARY</span><h1 id="library-title">{t.title}</h1><p>{t.description}</p></div><button className="primary-button" type="button" onClick={onNew}><Icon name="plus" size={20} />{t.create}</button></header>
    {legacyJobCount > 0 && <aside className="legacy-claim"><div><strong>{t.claim}</strong><p>{t.claimText.replace("{count}", String(legacyJobCount))}</p></div><div className="legacy-actions"><button type="button" className="text-button" onClick={() => void previewLegacy()}>{t.preview}</button><button type="button" className="secondary-button" disabled={claiming} onClick={() => void claimLegacy()}>{claiming ? t.claiming : t.claimAction}</button></div>{legacyJobs && <ul>{legacyJobs.map((item) => <li key={item.id}>{item.title}<small>{new Date(item.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US")}</small></li>)}</ul>}</aside>}
    <div className="library-tools"><label className="library-search"><Icon name="search" size={20} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} /></label><div className="library-filters" role="group" aria-label={language === "zh" ? "任务状态" : "Job status"}>{(["all", "active", "done", "failed"] as const).map((item) => <button type="button" key={item} className={status === item ? "selected" : ""} aria-pressed={status === item} onClick={() => setStatus(item)}>{t[item]}</button>)}</div></div>
    <div className="library-count" aria-live="polite"><span>{shownJobs.length} {t.count}</span><span>{t.private}</span></div>
    {error && <div className="library-error" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRevision((value) => value + 1)}>{t.reload}</button></div>}
    {loading ? <div className="library-empty" role="status">{t.loading}</div> : !jobs.length && !error ? <div className="library-empty"><CompanionPortrait /><h2>{t.empty}</h2><p>{t.emptyText}</p><button className="text-button" type="button" onClick={onNew}>{t.create}<Icon name="arrow-up-right" size={16} /></button></div> : !shownJobs.length && !error ? <div className="library-empty"><h2>{t.noMatches}</h2><button className="text-button" type="button" onClick={() => { setQuery(""); setStatus("all"); }}>{t.clear}</button></div> : <div className="library-rows">{shownJobs.map((item, index) => <article className="library-row" key={item.id} style={{ "--row-index": Math.min(index, 8) } as CSSProperties}><span className="library-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><button className="library-row-main" type="button" onClick={() => onOpen(item.id)}><span className="library-row-meta"><span className={`history-status ${item.status}`}><i />{t[item.status]}</span><span>{new Date(item.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" })}</span><span>{item.durationMs ? formatTime(item.durationMs) : item.source === "upload" ? t.upload : t.url}</span></span><h2>{item.title}</h2>{(item.summary || item.error) && <p className={item.error ? "row-error" : ""}>{item.summary || translateServerError(item.error, language, { preserveUnknown: true })}</p>}{(item.status === "queued" || item.status === "processing") && <div className="library-progress"><span style={{ width: `${Math.min(100, Math.max(0, item.progress.percent))}%` }} /></div>}</button><div className="library-row-actions"><button className="library-open" type="button" aria-label={`${t.open}: ${item.title}`} onClick={() => onOpen(item.id)}><Icon name="arrow-up-right" size={21} /></button><button className="text-button" type="button" disabled={deletingId === item.id} onClick={() => void remove(item.id)}>{deletingId === item.id ? t.deleting : t.delete}</button></div></article>)}</div>}
  </section>;
}
