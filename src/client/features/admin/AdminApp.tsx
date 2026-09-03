import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import "../../styles/atelier-admin.css";

type Language = "en" | "zh";
type StageName = "asr" | "vision";

interface AdminSession {
  enabled: boolean;
  authenticated: boolean;
}

interface SafeProvider {
  provider: string;
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  keyHint: string | null;
}

interface ProviderSettings {
  source: "environment" | "admin";
  updatedAt: number | null;
  providers: Record<StageName, SafeProvider>;
  options: Record<StageName, readonly string[]>;
  presets: Record<StageName, Record<string, { baseUrl: string; model: string }>>;
}

interface ProviderForm extends SafeProvider {
  apiKey: string;
}

interface AdminJob {
  id: string;
  source: "upload" | "url";
  title: string;
  status: string;
  stage: string;
  percent: number;
  detail: string;
  asrProvider: string;
  asrModel: string;
  visionProvider: string;
  visionModel: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  storagePrefix: string;
  mediaAvailable: boolean;
  error: string | null;
}

interface AnalysisSpec {
  instruction?: string;
  outputSchema?: unknown;
  artifactFormats?: string[];
}

interface AdminArtifact {
  id: string;
  name: string;
  format: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl?: string;
}

interface AdminAnalysisResult {
  title: string;
  durationMs: number;
  summary: string;
  tags?: unknown[];
  chapters?: unknown[];
  transcript?: unknown[];
  frames?: unknown[];
  extractedData?: unknown;
  artifacts?: AdminArtifact[];
}

interface AdminJobDetail {
  id: string;
  source: "upload" | "url";
  title: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  status: string;
  progress: { stage: string; percent: number; detail: string };
  language: Language;
  analysisSpec: AnalysisSpec;
  providers: Record<StageName, { provider: string; model: string }>;
  result: AdminAnalysisResult | null;
  error: string | null;
}

const copy = {
  en: {
    console: "CONTROL CENTER", title: "Koma administration", subtitle: "Providers, credentials, persistent jobs, and stored media in one protected workspace.",
    back: "Back to Koma", language: "中文", loginTitle: "Administrator sign in", loginText: "Use the ADMIN_PASSWORD configured on the server.",
    password: "Administrator password", signIn: "Sign in", signingIn: "Signing in…", disabled: "Administration is disabled",
    disabledText: "Set ADMIN_PASSWORD in the deployment environment and restart Koma. No default password is provided.",
    providers: "AI providers", providersText: "Changes apply to new jobs. Running jobs keep the provider snapshot they started with.",
    jobs: "Persistent jobs", jobsText: "Results and media remain replayable until an administrator permanently deletes the job.",
    save: "Save providers", saving: "Saving…", reset: "Use environment defaults", refresh: "Refresh", logout: "Sign out",
    asr: "Speech transcription", vision: "Vision analysis", provider: "Provider", model: "Model", baseUrl: "Base URL", apiKey: "API Key",
    keyKeep: "Leave blank to keep the configured key", keyNew: "Paste a server-side API key", configured: "Key configured", missing: "No key",
    sourceAdmin: "Managed in Koma", sourceEnvironment: "Environment defaults", active: "Active jobs", failed: "Failed", total: "History entries",
    status: "Status", created: "Created", pipeline: "Pipeline", action: "Action", view: "Replay", details: "Details", clear: "Delete", empty: "No jobs have been recorded yet.",
    jobDetails: "Analysis details", closeDetails: "Close", fullReplay: "Open full replay", requestConfig: "Extraction request", requestConfigText: "The exact request captured when this job was created.",
    defaultAnalysis: "Default analysis", defaultAnalysisText: "Title, summary, chapters, tags, transcript, and key frames.", customAnalysis: "Custom extraction", instruction: "Analysis requirement", outputShape: "Expected JSON shape", outputFiles: "Output files", noOutputFiles: "No downloadable files requested",
    providerSnapshot: "Provider snapshot", providerSnapshotText: "Models used by this job; API keys are never shown.", result: "Analysis result", resultPending: "No result has been saved yet.", resultJson: "Complete result JSON", requestedData: "Requested data", generatedFiles: "Generated files",
    source: "Source", outputLanguage: "Output language", duration: "Duration", completed: "Completed", chapters: "Chapters", subtitles: "Transcript lines", frames: "Key frames", tags: "Tags", loadingDetails: "Loading analysis details…",
    mockHint: "Mock mode runs the demo flow and does not use a model key.", saved: "Provider settings saved.", resetDone: "Environment defaults restored.",
    confirmReset: "Restore both providers from server environment variables?", confirmDelete: "Permanently delete this job, its database record, video, frames, and generated files?"
  },
  zh: {
    console: "CONTROL CENTER", title: "Koma 管理平台", subtitle: "在一个受保护的工作台里管理模型 Provider、密钥、永久任务和存储资产。",
    back: "返回 Koma", language: "EN", loginTitle: "管理员登录", loginText: "请输入服务器环境中配置的 ADMIN_PASSWORD。",
    password: "管理员密码", signIn: "进入管理平台", signingIn: "正在登录…", disabled: "管理平台尚未启用",
    disabledText: "在部署环境中设置 ADMIN_PASSWORD 并重启 Koma。系统不会提供默认密码。",
    providers: "AI Provider", providersText: "修改只影响新任务；正在运行的任务会继续使用创建时的配置快照。",
    jobs: "永久任务", jobsText: "结果与媒体会持续可回看，直到管理员在这里执行永久删除。",
    save: "保存 Provider", saving: "正在保存…", reset: "恢复环境变量", refresh: "刷新", logout: "退出登录",
    asr: "语音听写", vision: "视觉分析", provider: "Provider", model: "模型", baseUrl: "Base URL", apiKey: "API Key",
    keyKeep: "留空则保留当前已配置的 Key", keyNew: "粘贴只保存在服务端的 API Key", configured: "已配置 Key", missing: "未配置 Key",
    sourceAdmin: "由 Koma 后台管理", sourceEnvironment: "来自环境变量", active: "进行中任务", failed: "失败任务", total: "历史记录",
    status: "状态", created: "创建时间", pipeline: "模型链路", action: "操作", view: "回看", details: "详情", clear: "删除", empty: "暂时还没有任务记录。",
    jobDetails: "任务分析详情", closeDetails: "关闭", fullReplay: "打开完整回看", requestConfig: "提取配置", requestConfigText: "这里展示创建任务时实际保存的抓取要求。",
    defaultAnalysis: "默认分析", defaultAnalysisText: "标题、总结、章节、标签、字幕和关键帧。", customAnalysis: "自定义提取", instruction: "分析要求", outputShape: "期望 JSON 结构", outputFiles: "输出文件", noOutputFiles: "未要求生成下载文件",
    providerSnapshot: "任务模型快照", providerSnapshotText: "展示这个任务实际使用的模型；API Key 永远不会显示。", result: "分析结果", resultPending: "这个任务还没有保存分析结果。", resultJson: "完整结果 JSON", requestedData: "按要求提取的数据", generatedFiles: "生成文件",
    source: "来源", outputLanguage: "输出语言", duration: "视频时长", completed: "完成时间", chapters: "章节", subtitles: "字幕行", frames: "关键帧", tags: "标签", loadingDetails: "正在加载任务详情…",
    mockHint: "Mock 模式只运行演示流程，不会使用模型 Key。", saved: "Provider 配置已保存。", resetDone: "已恢复服务器环境变量配置。",
    confirmReset: "确定把两个 Provider 都恢复成服务器环境变量吗？", confirmDelete: "确定永久删除这个任务、数据库记录、视频、关键帧和生成文件吗？"
  }
} as const;

export default function AdminApp() {
  const [language, setLanguage] = useState<Language>(() => window.localStorage.getItem("koma-language") === "zh" ? "zh" : "en");
  const t = copy[language];
  const [session, setSession] = useState<AdminSession | null>(null);
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [forms, setForms] = useState<Record<StageName, ProviderForm> | null>(null);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobDetail, setJobDetail] = useState<AdminJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    window.localStorage.setItem("koma-language", language);
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    document.title = language === "zh" ? "Koma 管理平台" : "Koma Administration";
  }, [language]);

  useEffect(() => {
    void fetchJson<AdminSession>("/api/admin/session")
      .then((value) => { setSession(value); if (value.authenticated) void loadDashboard(); })
      .catch((cause) => { setError(messageOf(cause)); setSession({ enabled: false, authenticated: false }); });
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return undefined;
    const timer = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated]);

  useEffect(() => {
    if (!selectedJobId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeJobDetail();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedJobId]);

  async function loadDashboard() {
    try {
      const [nextSettings, nextJobs] = await Promise.all([
        fetchJson<ProviderSettings>("/api/admin/settings"),
        fetchJson<{ jobs: AdminJob[] }>("/api/admin/jobs")
      ]);
      setSettings(nextSettings);
      setForms(formsFromSettings(nextSettings));
      setJobs(nextJobs.jobs);
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) setSession((current) => current ? { ...current, authenticated: false } : current);
      setError(messageOf(cause));
    }
  }

  async function loadJobs() {
    try {
      const value = await fetchJson<{ jobs: AdminJob[] }>("/api/admin/jobs");
      setJobs(value.jobs);
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) setSession((current) => current ? { ...current, authenticated: false } : current);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await fetchJson("/api/admin/login", { method: "POST", headers: adminHeaders(), body: JSON.stringify({ password }) });
      setPassword(""); setSession({ enabled: true, authenticated: true }); await loadDashboard();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE", headers: adminHeaders(), credentials: "same-origin" });
    setSession((current) => current ? { ...current, authenticated: false } : current); setSettings(null); setForms(null); setJobs([]); closeJobDetail();
  }

  async function saveProviders(event: FormEvent) {
    event.preventDefault(); if (!forms) return; setBusy(true); setError(""); setNotice("");
    try {
      const next = await fetchJson<ProviderSettings>("/api/admin/settings", {
        method: "PUT", headers: adminHeaders(), body: JSON.stringify({ asr: stagePayload(forms.asr), vision: stagePayload(forms.vision) })
      });
      setSettings(next); setForms(formsFromSettings(next)); setNotice(t.saved);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function resetProviders() {
    if (!window.confirm(t.confirmReset)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const next = await fetchJson<ProviderSettings>("/api/admin/settings/reset", { method: "POST", headers: adminHeaders() });
      setSettings(next); setForms(formsFromSettings(next)); setNotice(t.resetDone);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function clearJob(id: string) {
    if (!window.confirm(t.confirmDelete)) return;
    try {
      await fetchJson(`/api/admin/jobs/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeaders() });
      setJobs((current) => current.filter((job) => job.id !== id));
      if (selectedJobId === id) closeJobDetail();
    } catch (cause) { setError(messageOf(cause)); }
  }

  async function openJobDetail(id: string) {
    setSelectedJobId(id); setJobDetail(null); setDetailLoading(true); setDetailError("");
    try {
      setJobDetail(await fetchJson<AdminJobDetail>(`/api/admin/jobs/${encodeURIComponent(id)}`));
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) setSession((current) => current ? { ...current, authenticated: false } : current);
      setDetailError(messageOf(cause));
    } finally { setDetailLoading(false); }
  }

  function closeJobDetail() {
    setSelectedJobId(null); setJobDetail(null); setDetailError(""); setDetailLoading(false);
  }

  function updateStage(stage: StageName, patch: Partial<ProviderForm>) {
    setForms((current) => current ? { ...current, [stage]: { ...current[stage], ...patch } } : current);
  }

  function selectProvider(stage: StageName, provider: string) {
    const preset = settings?.presets[stage]?.[provider] || { baseUrl: "", model: "" };
    updateStage(stage, { provider, baseUrl: preset.baseUrl, model: preset.model, apiKey: "", keyConfigured: provider === settings?.providers[stage].provider && settings.providers[stage].keyConfigured, keyHint: provider === settings?.providers[stage].provider ? settings.providers[stage].keyHint : null });
  }

  const stats = useMemo(() => ({
    active: jobs.filter((job) => job.status === "queued" || job.status === "processing").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    total: jobs.length
  }), [jobs]);

  return <div className="admin-shell">
    <header className="site-header"><div className="header-inner"><a className="admin-brand" href="/"><img src="/koma-icon-64.png" alt="" /><span><strong>Koma</strong><small>{t.console}</small></span></a><div className="header-actions"><button className="header-button" type="button" onClick={() => setLanguage(language === "en" ? "zh" : "en")}>{t.language}</button>{session?.authenticated && <button className="header-button" type="button" onClick={logout}>{t.logout}</button>}<a className="header-button" href="/">{t.back}</a></div></div></header>
    {session === null ? <main className="admin-centered"><div className="admin-loader" /></main>
      : !session.enabled ? <main className="admin-centered"><AdminMessage title={t.disabled} text={t.disabledText} /></main>
      : !session.authenticated ? <main className="admin-centered"><form className="admin-login" onSubmit={login}><img src="/koma-icon-64.png" alt="" /><span>{t.console}</span><h1>{t.loginTitle}</h1><p>{t.loginText}</p><label><strong>{t.password}</strong><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus required /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? t.signingIn : t.signIn}</button>{error && <p className="admin-error" role="alert">{error}</p>}</form></main>
      : <main className="admin-main">
        <section className="admin-heading"><div><span>{t.console}</span><h1>{t.title}</h1><p>{t.subtitle}</p></div><div className="admin-source"><i className={settings?.source === "admin" ? "online" : ""} /><span>{settings?.source === "admin" ? t.sourceAdmin : t.sourceEnvironment}<small>{settings?.updatedAt ? formatDate(settings.updatedAt, language) : "—"}</small></span></div></section>
        <section className="admin-stats"><Stat value={stats.active} label={t.active} /><Stat value={stats.failed} label={t.failed} danger={stats.failed > 0} /><Stat value={stats.total} label={t.total} /><Stat value={settings ? `${settings.providers.asr.provider} + ${settings.providers.vision.provider}` : "—"} label={t.pipeline} wide /></section>
        <section className="admin-section"><div className="admin-section-head"><div><span>01</span><h2>{t.providers}</h2><p>{t.providersText}</p></div><button className="secondary-button" type="button" onClick={resetProviders} disabled={busy}>{t.reset}</button></div>
          {settings && forms && <form className="provider-grid" onSubmit={saveProviders}><ProviderEditor stage="asr" title={t.asr} value={forms.asr} options={settings.options.asr} t={t} onChange={(patch) => updateStage("asr", patch)} onSelect={(provider) => selectProvider("asr", provider)} /><ProviderEditor stage="vision" title={t.vision} value={forms.vision} options={settings.options.vision} t={t} onChange={(patch) => updateStage("vision", patch)} onSelect={(provider) => selectProvider("vision", provider)} /><div className="provider-actions">{error && <p className="admin-error" role="alert">{error}</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? t.saving : t.save}</button></div></form>}
        </section>
        <section className="admin-section"><div className="admin-section-head"><div><span>02</span><h2>{t.jobs}</h2><p>{t.jobsText}</p></div><button className="secondary-button" type="button" onClick={() => void loadJobs()}>{t.refresh}</button></div><div className="job-table-wrap"><table className="job-table"><thead><tr><th>{t.status}</th><th>{t.created}</th><th>{t.pipeline}</th><th>{t.action}</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><div className="job-title"><StatusDot status={job.status} /><span><strong>{job.title}</strong><small>{job.status} · {job.percent}% · {job.source}</small></span></div></td><td><span className="job-date">{formatDate(job.createdAt, language)}<small>{job.mediaAvailable ? "persistent media" : "no media"}</small></span></td><td><span className="job-pipeline">{job.asrProvider}<i>→</i>{job.visionProvider}<small>{job.visionModel || "mock"}</small></span></td><td><span className="job-actions"><button className="secondary-button" type="button" onClick={() => void openJobDetail(job.id)}>{t.details}</button><a className="secondary-button" href={`/jobs/${job.id}`} target="_blank" rel="noreferrer">{t.view}</a><button className="danger-button" type="button" onClick={() => void clearJob(job.id)}>{t.clear}</button></span></td></tr>)}{jobs.length === 0 && <tr><td className="empty-cell" colSpan={4}>{t.empty}</td></tr>}</tbody></table></div></section>
      </main>}
    {session?.authenticated && selectedJobId && <JobDetailModal detail={jobDetail} loading={detailLoading} error={detailError} language={language} t={t} jobId={selectedJobId} onClose={closeJobDetail} />}
  </div>;
}

function JobDetailModal({ detail, loading, error, language, t, jobId, onClose }: { detail: AdminJobDetail | null; loading: boolean; error: string; language: Language; t: typeof copy.en | typeof copy.zh; jobId: string; onClose: () => void }) {
  const spec = detail?.analysisSpec || {};
  const custom = Boolean(spec.instruction || spec.outputSchema !== undefined || spec.artifactFormats?.length);
  const result = detail?.result;
  return <div className="modal-backdrop admin-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <article className="job-detail-modal" role="dialog" aria-modal="true" aria-labelledby="job-detail-title">
      <header className="job-detail-header">
        <div><span>{t.jobDetails}</span><h2 id="job-detail-title">{detail?.title || jobId}</h2><p>{detail?.id || jobId}</p></div>
        <div className="job-detail-header-actions">{detail && <a className="secondary-button" href={`/jobs/${detail.id}`} target="_blank" rel="noreferrer">{t.fullReplay}</a>}<button className="modal-close" type="button" onClick={onClose} aria-label={t.closeDetails}>×</button></div>
      </header>
      <div className="job-detail-body">
        {loading ? <div className="job-detail-loading"><div className="admin-loader" /><p>{t.loadingDetails}</p></div>
          : error ? <p className="admin-error job-detail-error" role="alert">{error}</p>
          : detail && <>
            <div className="job-detail-meta">
              <DetailMetric label={t.status} value={`${detail.status} · ${detail.progress.percent}%`} />
              <DetailMetric label={t.source} value={detail.source} />
              <DetailMetric label={t.outputLanguage} value={detail.language === "zh" ? "中文" : "English"} />
              <DetailMetric label={t.created} value={formatDate(detail.createdAt, language)} />
              <DetailMetric label={t.completed} value={detail.completedAt ? formatDate(detail.completedAt, language) : "—"} />
              <DetailMetric label={t.duration} value={result ? formatDuration(result.durationMs) : "—"} />
            </div>

            <section className="job-detail-section">
              <div className="job-detail-section-head"><div><span>REQUEST</span><h3>{t.requestConfig}</h3><p>{t.requestConfigText}</p></div><strong className={custom ? "custom" : ""}>{custom ? t.customAnalysis : t.defaultAnalysis}</strong></div>
              {!custom && <p className="job-detail-default">{t.defaultAnalysisText}</p>}
              {spec.instruction && <DetailBlock label={t.instruction}><p className="job-detail-instruction">{spec.instruction}</p></DetailBlock>}
              {spec.outputSchema !== undefined && <DetailBlock label={t.outputShape}><pre>{prettyJson(spec.outputSchema)}</pre></DetailBlock>}
              <DetailBlock label={t.outputFiles}>{spec.artifactFormats?.length ? <div className="job-detail-chips">{spec.artifactFormats.map((format) => <span key={format}>{format}</span>)}</div> : <p className="job-detail-muted">{t.noOutputFiles}</p>}</DetailBlock>
            </section>

            <section className="job-detail-section">
              <div className="job-detail-section-head"><div><span>MODEL</span><h3>{t.providerSnapshot}</h3><p>{t.providerSnapshotText}</p></div></div>
              <div className="job-provider-snapshot"><ProviderSnapshot label={t.asr} value={detail.providers.asr} /><ProviderSnapshot label={t.vision} value={detail.providers.vision} /></div>
            </section>

            <section className="job-detail-section">
              <div className="job-detail-section-head"><div><span>RESULT</span><h3>{t.result}</h3><p>{detail.progress.detail}</p></div><StatusDot status={detail.status} /></div>
              {result ? <>
                <p className="job-result-summary">{result.summary}</p>
                <div className="job-result-stats"><DetailMetric label={t.chapters} value={result.chapters?.length || 0} /><DetailMetric label={t.subtitles} value={result.transcript?.length || 0} /><DetailMetric label={t.frames} value={result.frames?.length || 0} /><DetailMetric label={t.tags} value={result.tags?.length || 0} /></div>
                {Object.prototype.hasOwnProperty.call(result, "extractedData") && <DetailBlock label={t.requestedData}><pre>{prettyJson(result.extractedData)}</pre></DetailBlock>}
                {result.artifacts?.length ? <DetailBlock label={t.generatedFiles}><div className="job-artifact-list">{result.artifacts.map((artifact) => artifact.downloadUrl ? <a key={artifact.id} href={artifact.downloadUrl}><span><strong>{artifact.name}</strong><small>{artifact.format.toUpperCase()} · {formatBytes(artifact.sizeBytes)}</small></span><i>↓</i></a> : <span key={artifact.id}>{artifact.name}</span>)}</div></DetailBlock> : null}
                <details className="job-result-json"><summary>{t.resultJson}</summary><pre>{prettyJson(result)}</pre></details>
              </> : <div className={`job-result-empty ${detail.status === "failed" ? "failed" : ""}`}><strong>{detail.error || detail.progress.detail || t.resultPending}</strong><p>{t.resultPending}</p></div>}
            </section>
          </>}
      </div>
    </article>
  </div>;
}

function DetailMetric({ label, value }: { label: string; value: ReactNode }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return <div className="job-detail-block"><h4>{label}</h4>{children}</div>;
}

function ProviderSnapshot({ label, value }: { label: string; value: { provider: string; model: string } }) {
  return <div><span>{label}</span><strong>{value.provider}</strong><small>{value.model || "mock"}</small></div>;
}

function ProviderEditor({ stage, title, value, options, t, onChange, onSelect }: { stage: StageName; title: string; value: ProviderForm; options: readonly string[]; t: typeof copy.en | typeof copy.zh; onChange: (patch: Partial<ProviderForm>) => void; onSelect: (provider: string) => void }) {
  const mock = value.provider === "mock";
  return <fieldset className="provider-card"><legend><span>{stage.toUpperCase()}</span><strong>{title}</strong></legend><div className={`key-state ${value.keyConfigured || mock ? "configured" : ""}`}><i />{mock ? "Demo" : value.keyConfigured ? `${t.configured} ${value.keyHint || ""}` : t.missing}</div><label><span>{t.provider}</span><select value={value.provider} onChange={(event) => onSelect(event.target.value)}>{options.map((provider) => <option value={provider} key={provider}>{provider}</option>)}</select></label>{mock ? <p className="provider-mock-note">{t.mockHint}</p> : <><label><span>{t.model}</span><input value={value.model} onChange={(event) => onChange({ model: event.target.value })} required /></label><label><span>{t.baseUrl}</span><input type="url" value={value.baseUrl} onChange={(event) => onChange({ baseUrl: event.target.value })} required /></label><label><span>{t.apiKey}</span><input type="password" value={value.apiKey} onChange={(event) => onChange({ apiKey: event.target.value })} placeholder={value.keyConfigured ? t.keyKeep : t.keyNew} autoComplete="new-password" /></label></>}</fieldset>;
}

function AdminMessage({ title, text }: { title: string; text: string }) {
  return <div className="admin-message"><div className="admin-message-icon">×</div><h1>{title}</h1><p>{text}</p><a className="primary-button" href="/">Koma</a></div>;
}

function Stat({ value, label, danger, wide }: { value: ReactNode; label: string; danger?: boolean; wide?: boolean }) {
  return <div className={`${danger ? "danger" : ""} ${wide ? "wide" : ""}`}><strong>{value}</strong><span>{label}</span></div>;
}

function StatusDot({ status }: { status: string }) {
  return <i className={`status-dot ${status}`} aria-label={status} />;
}

function formsFromSettings(settings: ProviderSettings): Record<StageName, ProviderForm> {
  return { asr: { ...settings.providers.asr, apiKey: "" }, vision: { ...settings.providers.vision, apiKey: "" } };
}

function stagePayload(value: ProviderForm) {
  return { provider: value.provider, model: value.model, baseUrl: value.baseUrl, ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}) };
}

function adminHeaders(): HeadersInit {
  return { "content-type": "application/json", "x-koma-admin": "1" };
}

async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new HttpError(response.status, body.error || `HTTP ${response.status}`);
  return body;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function formatDate(timestamp: number, language: Language): string {
  return dateFormatters[language].format(new Date(timestamp));
}

const dateFormatters: Record<Language, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  zh: new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
};

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function prettyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
