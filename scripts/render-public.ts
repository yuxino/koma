import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";
import { pageMetadata, publicPath, PUBLIC_ORIGIN, type PublicLanguage } from "../src/client/shared/public-site.js";

const template = await readFile("dist/index.html", "utf8");
const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));
const styles = new Set<string>();
function collectStyles(key: string) {
  const entry = manifest[key];
  if (!entry) return;
  for (const css of entry.css ?? []) styles.add(css);
  for (const imported of entry.imports ?? []) collectStyles(imported);
}
collectStyles("src/client/features/analyzer/App.tsx");
if (!styles.size) throw new Error("Public prerender requires the analyzer styles for no-JavaScript rendering.");
const base = template.replace(/\s*<(?:title|meta)\b[^>]*data-koma-seo[^>]*>(?:[^<]*<\/title>)?/g, "");
await writeFile("dist/app.html", base.replace("</head>", `${pageMetadata("en", false)}\n</head>`));

// Render the same component and initial public state used by browser hydration.
// No session, account, job, transcript, or runtime provider data enters this build.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { default: App } = await server.ssrLoadModule("/src/client/features/analyzer/App.tsx");
  for (const language of ["en", "zh"] as PublicLanguage[]) {
    const markup = renderToString(createElement(App, { initialLanguage: language }));
    if (!markup.includes('id="welcome-title"')) throw new Error("Public product content was not rendered.");
    const stylesheetLinks = [...styles].filter(css => !base.includes(`/${css}`)).map(css => `<link rel="stylesheet" href="/${css}" />`).join("\n");
    const html = base.replace('<html lang="en">', `<html lang="${language === "zh" ? "zh-CN" : "en"}">`)
      .replace("</head>", `${pageMetadata(language)}\n${stylesheetLinks}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root" data-prerendered="true">${markup}</div>`);
    const directory = language === "zh" ? "dist/zh" : "dist";
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/index.html`, html);
  }
} finally { await server.close(); }

// Let crawlers read noindex responses on non-public routes. Access control,
// rather than robots.txt, protects account data and generated media.
await writeFile("dist/robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${PUBLIC_ORIGIN}/sitemap.xml\n`);
const urls = (["en", "zh"] as PublicLanguage[]).map(language => `<url><loc>${PUBLIC_ORIGIN}${publicPath(language)}</loc></url>`).join("\n");
await writeFile("dist/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
console.log("Prerendered the English and Chinese public pages; private routes use an unindexed application shell.");
