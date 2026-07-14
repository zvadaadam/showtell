import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { themePresetManifest, type AspectRatio, type BundleError } from "@showtell/core";
import { addUniqueWarning, compileBundle, exactBundleFrameAt, lineSampleTimeMs } from "./bundle.ts";
import { createBundleFrameProducer } from "./frame-producer.ts";
import { serveStaticFile } from "./static-server.ts";

export interface WorkshopRenderedFrame {
  id: string;
  title: string;
  group: string;
  description: string;
  aspectRatio: AspectRatio;
  file: string;
  width: number;
  height: number;
  sceneId: string;
  lineId: string;
  lineIndex: number;
  sourceSha256?: string;
  propsSha256?: string;
  resolvedRefs: { file: string; sha256: string; bytes: number }[];
}

interface WorkshopThemeTokenSet {
  id: string;
  title: string;
  description: string;
  colors: {
    bg: string;
    fg: string;
    subtle: string;
    accent: string;
    accent2: string;
    success: string;
    warning: string;
    surface: string;
    border: string;
    captionBg: string;
    captionFg: string;
  };
  typography: { display: string; body: string; mono: string };
}

export interface WorkshopRenderResult {
  ok: true;
  stage: "bundle-workshop";
  outDir: string;
  indexPath: string;
  manifestPath: string;
  frames: WorkshopRenderedFrame[];
  themeTokens: WorkshopThemeTokenSet[];
  warnings: BundleError[];
}

export interface WorkshopHandle {
  port: number;
  url: string;
  outDir: string;
  stop(): void;
}

const WORKSHOP_THEMES: WorkshopThemeTokenSet[] = themePresetManifest().map((preset) => ({
  id: preset.id,
  title: preset.id.charAt(0).toUpperCase() + preset.id.slice(1),
  description: preset.description,
  colors: preset.colors,
  typography: preset.typography,
}));

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function writeIndex(outDir: string, title: string, frames: WorkshopRenderedFrame[]): string {
  const groups = [...new Set(frames.map((frame) => frame.group))];
  const body = groups
    .map((group) => {
      const cards = frames
        .filter((frame) => frame.group === group)
        .map(
          (frame) => `<article>
  <header><div><h3>${escapeHtml(frame.title)}</h3><p>${escapeHtml(frame.description)}</p></div><span>${escapeHtml(frame.aspectRatio)}</span></header>
  <img src="${escapeHtml(frame.file)}" width="${frame.width}" height="${frame.height}" alt="${escapeHtml(frame.title)} ${escapeHtml(frame.aspectRatio)}">
</article>`,
        )
        .join("\n");
      return `<section><h2>${escapeHtml(group)}</h2><div class="grid">${cards}</div></section>`;
    })
    .join("\n");
  const indexPath = join(outDir, "index.html");
  writeFileSync(
    indexPath,
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} Workshop</title><style>
:root{color-scheme:light;--bg:#f4f6f8;--fg:#171923;--muted:#616978;--line:#d9dee7;--panel:#fff;--accent:#5b67f1}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,sans-serif}
main{width:min(1680px,calc(100vw - 48px));margin:auto;padding:32px 0 56px}h1{font-size:clamp(32px,4vw,72px);margin:0}h2{margin:36px 0 14px}.summary{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(430px,1fr));gap:18px}article{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
article header{min-height:96px;display:flex;justify-content:space-between;gap:18px;padding:18px;border-bottom:1px solid var(--line)}h3{margin:0 0 7px}p{margin:0;color:var(--muted);line-height:1.45}span{height:fit-content;border:1px solid var(--line);border-radius:999px;padding:5px 10px;color:var(--muted);font-weight:700;font-size:12px}img{display:block;width:100%;height:auto;background:#101322}
@media(max-width:720px){main{width:min(100vw - 24px,680px)}.grid{grid-template-columns:1fr}}
</style></head><body><main><h1>${escapeHtml(title)} Workshop</h1><p class="summary">${frames.length} held line states from the production renderer.</p>${body}</main></body></html>`,
  );
  return indexPath;
}

export async function renderBundleWorkshop(
  bundleDirInput: string,
  opts: { outDir?: string; aspectRatios?: AspectRatio[]; watermark?: string | false } = {},
): Promise<WorkshopRenderResult> {
  const compiled = await compileBundle(bundleDirInput);
  const outDir = resolve(opts.outDir ?? join(compiled.bundleDir, "workshop"));
  const ratios = opts.aspectRatios ?? compiled.spec.meta.aspectRatios;
  mkdirSync(outDir, { recursive: true });
  const frames: WorkshopRenderedFrame[] = [];
  const warnings: BundleError[] = [...compiled.warnings];
  const warningKeys = new Set(warnings.map((warning) => `${warning.path}:${warning.message}`));
  const frameProducer = createBundleFrameProducer(compiled);

  try {
    for (const aspectRatio of ratios) {
      for (const scene of compiled.spec.scenes) {
        const planScene = compiled.plan.scenes.find((item) => item.id === scene.id)!;
        if (scene.visual.kind === "screencap") {
          addUniqueWarning(warnings, warningKeys, {
            code: "SCREENCAP_NOT_IN_WORKSHOP",
            path: `scenes.${planScene.index}.visual`,
            message: "Screencap is timed media and has no browser-held workshop frame.",
            hint: "Render the bundle to inspect the encoded capture; workshop covers authored browser layouts.",
          });
          continue;
        }
        for (let lineIndex = 0; lineIndex < planScene.narration.lines.length; lineIndex++) {
          const line = planScene.narration.lines[lineIndex]!;
          const exact = exactBundleFrameAt(
            planScene,
            { timeMs: lineSampleTimeMs(line, 0.5, compiled.spec.meta.fps), preferredLineIndex: lineIndex },
            compiled.spec.meta.fps,
          );
          const rendered = await frameProducer.render({
            scene,
            compiledScene: planScene,
            aspectRatio,
            exact,
            presentation: { watermark: opts.watermark ?? "showtell", presenterAmplitude: 0 },
          });
          if (rendered.warning) {
            addUniqueWarning(warnings, warningKeys, {
              code: "RENDER_WARNING",
              path: `scenes.${planScene.index}.narration.lines.${lineIndex}`,
              message: rendered.warning,
              hint: "Inspect the visual inputs for this line; the renderer produced a fallback or warning state.",
            });
          }
          const file = `scene-${String(planScene.index).padStart(3, "0")}-${scene.id}-${line.id}-${aspectRatio.replace(":", "x")}.png`;
          writeFileSync(join(outDir, file), rendered.png);
          frames.push({
            id: `${scene.id}/${line.id}`,
            title: `${scene.id} / ${line.id}`,
            group: scene.id,
            description: line.text,
            aspectRatio,
            file,
            width: rendered.width,
            height: rendered.height,
            sceneId: scene.id,
            lineId: line.id,
            lineIndex,
            sourceSha256: planScene.program.kind === "web" ? planScene.program.sourceSha256 : undefined,
            propsSha256: planScene.program.kind === "web" ? planScene.program.propsSha256 : undefined,
            resolvedRefs: rendered.resolvedRefs.map((ref) => ({
              file: ref.file,
              bytes: Buffer.byteLength(ref.text),
              sha256: sha256(ref.text),
            })),
          });
        }
      }
    }

    const indexPath = writeIndex(outDir, compiled.spec.meta.title, frames);
    const manifestPath = join(outDir, "workshop-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          title: `${compiled.spec.meta.title} Workshop`,
          bundleDir: ".",
          planPath: "compiled-plan.json",
          frames,
          themeTokens: WORKSHOP_THEMES,
          warnings,
        },
        null,
        2,
      ) + "\n",
    );
    return {
      ok: true,
      stage: "bundle-workshop",
      outDir,
      indexPath,
      manifestPath,
      frames,
      themeTokens: WORKSHOP_THEMES,
      warnings,
    };
  } finally {
    await frameProducer.close();
  }
}

export function startWorkshopServer(opts: { outDir: string; port?: number }): WorkshopHandle {
  const outDir = resolve(opts.outDir);
  const server = Bun.serve({
    // Local watch servers only: repo-derived frames must not be LAN-visible.
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path === "/status") return Response.json({ ok: true, stage: "workshop-serve", outDir });
      if (path === "/") path = "/index.html";
      return serveStaticFile(outDir, path.slice(1)) ?? new Response("not found", { status: 404 });
    },
  });
  const port = server.port;
  if (port == null) throw new Error("Workshop server failed to bind to a port.");
  return { port, url: `http://127.0.0.1:${port}/`, outDir, stop: () => server.stop(true) };
}
