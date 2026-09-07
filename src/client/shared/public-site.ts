export type PublicLanguage = "en" | "zh";
export const PUBLIC_ORIGIN = "https://koma.yuxino.cn";
export const REPOSITORY_URL = "https://github.com/yuxino/koma";

export function publicPath(language: PublicLanguage): string { return language === "zh" ? "/zh/" : "/"; }
export function publicLanguage(pathname: string): PublicLanguage | undefined {
  if (pathname === "/") return "en";
  if (pathname === "/zh/") return "zh";
  return undefined;
}

const descriptions = {
  en: "Koma is a self-hosted AI video analysis website. Turn uploaded videos or public links into summaries, chapters, searchable subtitles, key frames, and structured data.",
  zh: "Koma 是可自行部署的 AI 视频分析网站。上传视频或粘贴公开视频链接，生成摘要、章节、可搜索字幕、关键帧与结构化数据，对照原片回看并下载结果。"
};
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function pageMetadata(language: PublicLanguage, indexable = true): string {
  const title = language === "zh" ? "Koma — AI 视频分析、字幕与关键帧" : "Koma — AI Video Analysis, Subtitles & Key Frames";
  const base = `<title data-koma-seo>${escapeHtml(title)}</title>`;
  if (!indexable) return `${base}\n<meta data-koma-seo name="robots" content="noindex, nofollow, noarchive" />`;
  const url = PUBLIC_ORIGIN + publicPath(language);
  const lang = language === "zh" ? "zh-CN" : "en";
  const image = `${PUBLIC_ORIGIN}/koma-logo-round.png`;
  const description = descriptions[language];
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${PUBLIC_ORIGIN}/#website`, name: "Koma", url: `${PUBLIC_ORIGIN}/`, inLanguage: ["en", "zh-CN"] },
      { "@type": "SoftwareApplication", "@id": `${PUBLIC_ORIGIN}/#application`, name: "Koma", url: `${PUBLIC_ORIGIN}/`, applicationCategory: "MultimediaApplication", operatingSystem: "Web browser", description, sameAs: REPOSITORY_URL },
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: title, description, inLanguage: lang, isPartOf: { "@id": `${PUBLIC_ORIGIN}/#website` }, about: { "@id": `${PUBLIC_ORIGIN}/#application` } }
    ]
  };
  const meta = (name: string, content: string, property = false) => `<meta data-koma-seo ${property ? "property" : "name"}="${name}" content="${escapeHtml(content)}" />`;
  return [base,
    meta("description", description), meta("robots", "index, follow"),
    `<link data-koma-seo rel="canonical" href="${url}" />`,
    `<link data-koma-seo rel="alternate" hreflang="en" href="${PUBLIC_ORIGIN}/" />`,
    `<link data-koma-seo rel="alternate" hreflang="zh-CN" href="${PUBLIC_ORIGIN}/zh/" />`,
    `<link data-koma-seo rel="alternate" hreflang="x-default" href="${PUBLIC_ORIGIN}/" />`,
    meta("og:type", "website", true), meta("og:site_name", "Koma", true), meta("og:title", title, true), meta("og:description", description, true), meta("og:url", url, true),
    meta("og:locale", language === "zh" ? "zh_CN" : "en_US", true), meta("og:locale:alternate", language === "zh" ? "en_US" : "zh_CN", true),
    meta("og:image", image, true), meta("og:image:type", "image/png", true), meta("og:image:width", "512", true), meta("og:image:height", "512", true), meta("og:image:alt", language === "zh" ? "Koma 圆形人物标志" : "Koma circular character logo", true),
    meta("twitter:card", "summary"), meta("twitter:title", title), meta("twitter:description", description), meta("twitter:image", image), meta("twitter:image:alt", language === "zh" ? "Koma 圆形人物标志" : "Koma circular character logo"),
    `<script data-koma-seo type="application/ld+json">${JSON.stringify(graph).replace(/</g, "\\u003c")}</script>`
  ].join("\n");
}
