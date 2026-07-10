import fastifyStatic from "@fastify/static";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";

const INDEX_CACHE_CONTROL = "no-cache, no-store, must-revalidate";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const RESERVED_PREFIXES = [
  "/v1",
  "/healthz",
  "/readyz",
  "/socket.io",
  "/assets",
  "/.well-known",
] as const;

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? "/";
}

function hasReservedPrefix(value: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

function looksLikeFileRequest(value: string): boolean {
  const finalSegment = value.split("/").at(-1) ?? "";
  return finalSegment.includes(".");
}

export function isSpaBrowserRequest(request: FastifyRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const value = requestPath(request);
  if (hasReservedPrefix(value) || looksLikeFileRequest(value)) return false;
  const accept = request.headers.accept ?? "";
  return accept.split(",").some((entry) => entry.trim().split(";", 1)[0] === "text/html");
}

export function cacheControlForStaticFile(filePath: string): string {
  const filename = path.basename(filePath);
  if (filename === "index.html" || /^manifest(?:\.[a-z0-9_-]+)?\.json$/iu.test(filename)) {
    return INDEX_CACHE_CONTROL;
  }
  const normalized = filePath.split(path.sep).join("/");
  if (/-[a-z0-9_-]{8,}\.(?:css|js|map|woff2?)$/iu.test(normalized)) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  // Public GLB, textures and other stable paths can change between releases.
  // ETag/Last-Modified revalidation prevents a year-long mixed client/art version.
  return REVALIDATE_CACHE_CONTROL;
}

export async function registerClientHosting(
  app: FastifyInstance,
  clientDistPath: string,
): Promise<void> {
  const root = path.resolve(clientDistPath);
  const rootStats = await stat(root).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Client distribution directory is unavailable: ${root}`);
  }

  await app.register(fastifyStatic, {
    root,
    prefix: "/",
    dotfiles: "deny",
    serveDotFiles: false,
    cacheControl: false,
    etag: true,
    lastModified: true,
    setHeaders(response, filePath) {
      response.setHeader("Cache-Control", cacheControlForStaticFile(filePath));
    },
  });

  app.setNotFoundHandler((request, reply) => {
    if (isSpaBrowserRequest(request)) {
      return reply
        .header("Cache-Control", INDEX_CACHE_CONTROL)
        .type("text/html; charset=utf-8")
        .sendFile("index.html");
    }
    return reply.code(404).send({
      error: "not_found",
      message: "Ресурс не найден",
    });
  });
}
