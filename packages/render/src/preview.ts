/**
 * Local preview server — a localhost watch page for rendered videos, mirroring
 * Mainframe's review-before-share ergonomics and {videoId,status,watchUrl}
 * shape. No external deps (Bun.serve). Sharing/upload is Phase-2.
 */
import { basename } from "node:path";

export interface PreviewOutput {
  aspectRatio: string;
  path: string;
}

export interface PreviewHandle {
  videoId: string;
  port: number;
  url: string;
  watchUrl: string;
  stop(): void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function renderHtml(opts: { title: string; videoId: string; outputs: PreviewOutput[] }): string {
  const title = escapeHtml(opts.title);
  const sources = opts.outputs.map((o) => ({ ar: o.aspectRatio, file: basename(o.path) }));
  const first = sources[0]!;
  const buttons = sources
    .map(
      (s, i) =>
        `<button data-src="/video/${encodeURIComponent(s.file)}" class="${i === 0 ? "active" : ""}">${escapeHtml(s.ar)}</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · agent-video</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0f0f17; color:#e8e8f2; font:16px/1.5 -apple-system,Inter,system-ui,sans-serif;
         display:flex; flex-direction:column; align-items:center; min-height:100vh; }
  header { width:100%; max-width:980px; padding:24px 20px 8px; box-sizing:border-box; display:flex; justify-content:space-between; align-items:baseline; }
  h1 { font-size:20px; margin:0; font-weight:600; }
  .brand { color:#9aa0b4; font-size:13px; text-decoration:none; }
  main { width:100%; max-width:980px; padding:8px 20px 40px; box-sizing:border-box; }
  video { width:100%; border-radius:12px; background:#000; box-shadow:0 8px 40px rgba(0,0,0,.5); }
  .ratios { display:flex; gap:8px; margin:14px 0; }
  button { background:#1a1a2e; color:#cfd2e0; border:1px solid rgba(255,255,255,.08); border-radius:8px;
           padding:6px 14px; font-size:14px; cursor:pointer; }
  button.active { background:#7c8cff; color:#0b0b14; border-color:#7c8cff; }
  .meta { color:#9aa0b4; font-size:13px; margin-top:12px; }
</style></head>
<body>
  <header><h1>${title}</h1><a class="brand" href="https://agent-video.dev">agent-video.dev</a></header>
  <main>
    <video id="player" controls playsinline preload="auto" src="/video/${encodeURIComponent(first.file)}"></video>
    <div class="ratios" id="ratios">${buttons}</div>
    <div class="meta">video id <code>${escapeHtml(opts.videoId)}</code> · status <span id="status">success</span></div>
  </main>
  <script>
    const player = document.getElementById('player');
    for (const b of document.querySelectorAll('#ratios button')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('#ratios button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const t = player.currentTime; player.src = b.dataset.src; player.currentTime = t; player.play();
      });
    }
  </script>
</body></html>`;
}

/** Start a localhost preview server. Returns immediately with a stable watchUrl. */
export function startPreviewServer(opts: {
  outputs: PreviewOutput[];
  title: string;
  videoId: string;
  port?: number;
}): PreviewHandle {
  const byFile = new Map(opts.outputs.map((o) => [basename(o.path), o.path]));
  const server = Bun.serve({
    port: opts.port ?? 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/" || u.pathname === `/v/${opts.videoId}`) {
        return new Response(renderHtml(opts), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (u.pathname === "/status") {
        return Response.json({ videoId: opts.videoId, status: "success" });
      }
      const m = u.pathname.match(/^\/video\/(.+)$/);
      if (m) {
        const file = byFile.get(decodeURIComponent(m[1]!));
        if (file) return new Response(Bun.file(file), { headers: { "content-type": "video/mp4" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  const port = server.port;
  if (port == null) throw new Error("Preview server failed to bind to a port.");
  return {
    videoId: opts.videoId,
    port,
    url: `http://localhost:${port}/`,
    watchUrl: `http://localhost:${port}/v/${opts.videoId}`,
    stop: () => server.stop(true),
  };
}
