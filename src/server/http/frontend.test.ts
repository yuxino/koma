import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { frontendResponseHeaders, PRIVATE_ROBOTS, registerFrontend } from "./frontend.js";

const JOB = "/jobs/00000000-0000-4000-8000-000000000000";
const PUBLIC_EN = '<!doctype html><html lang="en"><title>Koma video analysis</title><script type="application/ld+json">{"@type":"SoftwareApplication"}</script><main>English product page</main></html>';
const PUBLIC_ZH = '<!doctype html><html lang="zh-CN"><title>Koma 视频分析</title><main>中文产品页面</main></html>';
const PRIVATE_APP = '<!doctype html><html><meta name="robots" content="noindex,nofollow,noarchive"><div id="root"></div><script src="/assets/app.js"></script></html>';
let directory: string;
let app: FastifyInstance;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "koma-frontend-test-"));
  for (const folder of ["zh", "assets", "nested", "api", "admin", "jobs"]) await mkdir(join(directory, folder));
  const files: Record<string, string> = {
    "index.html": PUBLIC_EN, "zh/index.html": PUBLIC_ZH, "app.html": PRIVATE_APP,
    "nested/index.html": "unlisted HTML", "extra.HTML": "unlisted HTML",
    "app.html.gz": "internal document archive", ".hidden": "hidden file",
    "assets/app.js": "console.log('public script');", "assets/app.css": "body{color:#222}",
    "logo.png": "public image", "robots.txt": "User-agent: *\nAllow: /\n",
    "sitemap.xml": "<urlset><url><loc>https://koma.example/</loc></url><url><loc>https://koma.example/zh/</loc></url></urlset>",
    "api/static.txt": "must not shadow API", "admin/static.txt": "must not shadow admin", "jobs/static.txt": "must not shadow jobs"
  };
  await Promise.all(Object.entries(files).map(([file, content]) => writeFile(join(directory, file), content)));
  app = Fastify();
  app.addHook("onRequest", frontendResponseHeaders);
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/private", async (_request, reply) => reply.code(401).send({ error: "Authentication required" }));
  app.post("/api/rejected", async (_request, reply) => reply.code(403).send({ error: "Request rejected" }));
  app.get("/api/failure", async () => { throw new Error("Test failure"); });
  app.get("/api/redirect", async (_request, reply) => reply.redirect("/", 302));
  app.get("/api/range", async (_request, reply) => reply.code(206).header("content-range", "bytes 0-1/3").send("ab"));
  await registerFrontend(app, directory);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("public document routes", () => {
  it.each([["/", PUBLIC_EN, "en"], ["/zh/", PUBLIC_ZH, "zh-CN"]])("serves only the matching public HTML at %s, including HEAD", async (url, body, language) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(body);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain(`lang="${language}"`);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
    const head = await app.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["content-type"]).toContain("text/html");
    expect(head.headers["x-robots-tag"]).toBeUndefined();
    const withCookie = await app.inject({ url, headers: { cookie: "koma_session=not-a-real-session; koma_viewer=example" } });
    expect(withCookie.body).toBe(body);
  });

  it.each([["/zh", "/zh/"], ["/en", "/"], ["/en/", "/"], ["/index.html", "/"], ["/zh/index.html", "/zh/"]])("redirects the alias %s to %s", async (url, target) => {
    for (const method of ["GET", "HEAD"] as const) {
      const response = await app.inject({ method, url: `${url}?auth=expired` });
      expect(response.statusCode).toBe(308);
      expect(response.headers.location).toBe(`${target}?auth=expired`);
      if (method === "HEAD") expect(response.body).toBe("");
    }
  });

  it.each(["/assets/app.js", "/assets/app.css", "/logo.png", "/robots.txt", "/sitemap.xml"])("keeps public assets and crawler files available at %s", async url => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
    expect(response.body).not.toContain("<html");
  });
});

describe("private application shell", () => {
  it.each(["/admin", "/admin/", JOB, `${JOB}/`])("serves the non-indexable shell for %s, including HEAD", async url => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(PRIVATE_APP);
    expect(response.body).not.toMatch(/SoftwareApplication|English product page|中文产品页面/);
    expect(response.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
    expect(response.headers["cache-control"]).toBe("no-store");
    const head = await app.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
    expect(head.headers["cache-control"]).toBe("no-store");
    if (response.headers.etag) {
      const conditional = await app.inject({ url, headers: { "if-none-match": String(response.headers.etag) } });
      expect(conditional.statusCode).toBe(304);
      expect(conditional.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
      expect(conditional.headers["cache-control"]).toBe("no-store");
    }
  });

  it.each(["/unknown", "/admin/not-a-page", "/jobs", "/jobs/not-a-job", `${JOB}/extra`, "/api", "/api/missing", "/assets/missing.js", "/app.html", "/%61pp.html", "/app%2ehtml", "/extra.HTML", "/nested", "/nested/", "/nested/index.html", "/app.html.gz", "/api/static.txt", "/admin/static.txt", "/jobs/static.txt", "/.hidden", "/%2ehidden"])("does not fall back to public HTML for %s", async url => {
    for (const method of ["GET", "HEAD"] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(response.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("<html");
    }
  });
});

describe("early API response headers", () => {
  it.each([["/api/health", 200], ["/%61pi/health", 200], ["/api/private", 401], ["/api/missing", 404], ["/api/failure", 500], ["/api/redirect", 302], ["/api/range", 206]])("preserves status and robots protection for %s", async (url, status) => {
    for (const method of ["GET", "HEAD"] as const) {
      const response = await app.inject({ method, url: `${url}?example=1` });
      expect(response.statusCode).toBe(status);
      expect(response.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("keeps headers on rejected writes and malformed API JSON", async () => {
    const rejected = await app.inject({ method: "POST", url: "/api/rejected", payload: {} });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
    expect(rejected.headers["cache-control"]).toBe("no-store");
    const malformed = await app.inject({ method: "POST", url: "/api/rejected", headers: { "content-type": "application/json" }, payload: "{" });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
    expect(malformed.headers["cache-control"]).toBe("no-store");
  });
});

describe("missing frontend build", () => {
  it("preserves the development hint without indexing it or swallowing unknown routes", async () => {
    const development = Fastify();
    development.addHook("onRequest", frontendResponseHeaders);
    await registerFrontend(development, join(directory, "absent-build"));
    try {
      const response = await development.inject({ url: "/" });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("npm run dev");
      expect(response.headers["x-robots-tag"]).toBe(PRIVATE_ROBOTS);
      expect((await development.inject({ url: "/unknown" })).statusCode).toBe(404);
    } finally { await development.close(); }
  });
});
