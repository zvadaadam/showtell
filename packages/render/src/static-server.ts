import { extname } from "node:path";
import { SafeFileError, safeExistingFileInRoot } from "@showtell/core";

export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function contentType(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function serveStaticFile(rootDir: string, urlPath: string): Response | undefined {
  const rel = urlPath.replace(/^\/+/, "");
  // Never serve dotfiles or render intermediates (.work, .showtell caches).
  if (rel.split(/[\\/]/).some((part) => part.startsWith("."))) return undefined;
  try {
    const file = safeExistingFileInRoot(rootDir, rel).path;
    return new Response(Bun.file(file), { headers: { "content-type": contentType(file) } });
  } catch (e) {
    if (e instanceof SafeFileError) return undefined;
    throw e;
  }
}
