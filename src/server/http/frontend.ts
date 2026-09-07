import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const PRIVATE_ROBOTS = "noindex, nofollow, noarchive";
const JOB_PAGE = /^\/jobs\/[a-f0-9-]{20,64}\/?$/i;
const PUBLIC_PAGES = new Map([["/", "index.html"], ["/zh/", "zh/index.html"]]);
const ALIASES = new Map([
  ["/zh", "/zh/"], ["/en", "/"], ["/en/", "/"],
  ["/index.html", "/"], ["/zh/index.html", "/zh/"]
]);

/** Runs before API handlers, including authentication failures and redirects. */
export async function frontendResponseHeaders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = decodedPath(request);
  if (privateNamespace(path)) privateHeaders(reply);
  if (/[\\\u0000-\u001f\u007f]/.test(path) || /\/{2,}|(?:^|\/)\./.test(path)) notFound(reply);
}

/** Expose two public documents and a separate, non-indexable application shell. */
export async function registerFrontend(app: FastifyInstance, root = resolve("dist")): Promise<void> {
  app.setNotFoundHandler((_request, reply) => notFound(reply));

  for (const [path, destination] of ALIASES) {
    app.get(path, async (request, reply) => {
      const queryAt = request.url.indexOf("?");
      const query = queryAt === -1 ? "" : request.url.slice(queryAt);
      return reply.redirect(destination + query, 308);
    });
  }

  const available = await stat(root).then(info => info.isDirectory()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (!available) {
    for (const path of PUBLIC_PAGES.keys()) {
      app.get(path, async (_request, reply) => privateHeaders(reply).type("text/plain").send("Run npm run dev for the frontend, or npm run build first."));
    }
    return;
  }

  await app.register(fastifyStatic, {
    root,
    index: false,
    redirect: false,
    dotfiles: "deny",
    allowedPath: (path, _root, request) => {
      const document = pageDocument(requestPath(request));
      const relativePath = path.replace(/^\/+/, "");
      if (document) return relativePath === document;
      // Static files must never create another HTML entry or shadow a private route.
      return !privateNamespace(decodedPath(request))
        && !privateNamespace(`/${relativePath}`)
        && !relativePath.endsWith("/")
        && !/\.html?(?:[./]|$)/i.test(relativePath);
    }
  });

  for (const [path, document] of PUBLIC_PAGES) {
    app.get(path, async (_request, reply) => reply.sendFile(document));
  }
  for (const path of ["/admin", "/admin/", "/jobs/:id", "/jobs/:id/"]) {
    app.get(path, async (request, reply) => {
      if (pageDocument(requestPath(request)) !== "app.html") return notFound(reply);
      return privateHeaders(reply).sendFile("app.html", { cacheControl: false });
    });
  }
}

function pageDocument(path: string): string | undefined {
  return PUBLIC_PAGES.get(path) ?? ((path === "/admin" || path === "/admin/" || JOB_PAGE.test(path)) ? "app.html" : undefined);
}

function privateNamespace(path: string): boolean {
  return /^\/(?:api|jobs|admin)(?:\/|$)/i.test(path);
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0];
}

function decodedPath(request: FastifyRequest): string {
  try { return decodeURIComponent(requestPath(request)); } catch { return requestPath(request); }
}

function privateHeaders(reply: FastifyReply): FastifyReply {
  return reply.header("x-robots-tag", PRIVATE_ROBOTS).header("cache-control", "no-store");
}

function notFound(reply: FastifyReply): FastifyReply {
  return privateHeaders(reply).code(404).send({ error: "没有找到这个地址。" });
}
