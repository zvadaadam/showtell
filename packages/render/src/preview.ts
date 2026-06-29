/**
 * Local watch server — the "npx serve" of agent-video bundles. Serves the built
 * web player (a static SPA) at `/`, plus the rendered bundle (manifest.json +
 * mp4s + thumbnails) at `/bundle/*`. The agent hands back a live URL, not a file.
 *
 * Zero external deps (Bun.serve). Sharing/upload is the paid, hosted tier.
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve, normalize, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PreviewHandle {
  videoId: string;
  port: number;
  url: string;
  watchUrl: string;
  stop(): void;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate the built player (packages/player/dist/client). Tries cwd-relative
 * first (running from the repo), then relative to this package. Throws with a
 * build hint if it isn't built yet.
 */
export function resolvePlayerDist(): string {
  const candidates = [
    join(process.cwd(), "packages/player/dist/client"),
    join(HERE, "..", "..", "player", "dist", "client"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "_shell.html"))) return resolve(c);
  }
  throw new Error(
    "Player build not found (packages/player/dist/client/_shell.html). Build it first: `cd packages/player && bun --bun run build`.",
  );
}

const CTYPE: Record<string, string> = {
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

function contentType(p: string): string {
  return CTYPE[extname(p).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve `rel` under `root`, rejecting path traversal. null if unsafe/missing. */
function safeFile(root: string, rel: string): string | null {
  if (rel.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + "/")) return null; // escaped root
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}

/**
 * Start a localhost watch server for a rendered bundle + the built player.
 * Returns immediately with a stable watchUrl; the server runs until stop().
 */
export function startPreviewServer(opts: {
  bundleDir: string;
  playerDir: string;
  title: string;
  videoId: string;
  port?: number;
}): PreviewHandle {
  const bundleDir = resolve(opts.bundleDir);
  const playerDir = resolve(opts.playerDir);
  const shell = join(playerDir, "_shell.html");

  const server = Bun.serve({
    port: opts.port ?? 0,
    fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);

      if (path === "/status") {
        return Response.json({ videoId: opts.videoId, status: "success", title: opts.title });
      }

      // the rendered bundle: manifest.json, mp4s, thumbnails
      if (path.startsWith("/bundle/")) {
        const f = safeFile(bundleDir, path.slice("/bundle/".length));
        if (f) return new Response(Bun.file(f), { headers: { "content-type": contentType(f) } });
        return new Response("not found", { status: 404 });
      }

      // static player assets (hashed JS/CSS, favicon, …)
      if (path === "/") path = "/_shell.html";
      const asset = safeFile(playerDir, path);
      if (asset) return new Response(Bun.file(asset), { headers: { "content-type": contentType(asset) } });

      // SPA fallback → the prerendered shell
      return new Response(Bun.file(shell), { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });

  const port = server.port;
  if (port == null) throw new Error("Preview server failed to bind to a port.");
  const url = `http://localhost:${port}/`;
  return { videoId: opts.videoId, port, url, watchUrl: url, stop: () => server.stop(true) };
}
