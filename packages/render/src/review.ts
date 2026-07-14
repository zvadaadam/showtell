import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AspectRatio, BundleError } from "@showtell/core";
import { compileBundle, exactBundleFrameAt, lineSampleFractions, lineSampleTimeMs } from "./bundle.ts";
import { amplitudeAt } from "./envelope.ts";
import { createBundleFrameProducer, type BundleFrameProducer } from "./frame-producer.ts";

export const MAX_REVIEW_SAMPLES_PER_LINE = 60;

export class BundleReviewError extends Error {
  readonly hint: string;
  readonly extra?: Record<string, unknown>;

  constructor(message: string, hint: string, extra?: Record<string, unknown>) {
    super(message);
    this.hint = hint;
    this.extra = extra;
  }
}

export interface BundleReviewSample {
  aspectRatio: AspectRatio;
  fraction: number;
  timeMs: number;
  frame: number;
  path: string;
  sha256: string;
  baseSha256?: string;
  basePixelDeltaFromPrevious?: number;
}

export interface BundleReviewAspectMetrics {
  aspectRatio: AspectRatio;
  basePixelDeltaMax?: number;
}

export interface BundleReviewLine {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  samples: BundleReviewSample[];
  advisory: {
    basePixelDeltaMax?: number;
    aspectMetrics: BundleReviewAspectMetrics[];
    warnings: BundleError[];
  };
}

export interface BundleReviewScene {
  id: string;
  index: number;
  lines: BundleReviewLine[];
}

export interface BundleReviewResult {
  ok: true;
  stage: "bundle-review";
  bundleDir: string;
  outDir: string;
  indexPath: string;
  manifestPath: string;
  samplesPerLine: number;
  aspectRatios: AspectRatio[];
  scenes: BundleReviewScene[];
  advisory: {
    warnings: BundleError[];
    metrics: {
      totalSamples: number;
      staticVisualLines: number;
    };
  };
}

interface RenderedReviewSample {
  png: Buffer;
  sha256: string;
  baseSha256?: string;
  rgba?: Buffer;
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function rel(base: string, path: string): string {
  const r = relative(base, path).replaceAll("\\", "/");
  return r && !r.startsWith("../") && r !== ".." ? r : path;
}

function basePixelDelta(previous: Buffer | undefined, current: Buffer | undefined): number | undefined {
  if (!previous || !current || previous.length !== current.length) return undefined;
  let changed = 0;
  for (let i = 0; i < current.length; i++) {
    if (previous[i] !== current[i]) changed++;
  }
  return changed / current.length;
}

async function renderReviewSample(
  producer: BundleFrameProducer,
  request: Parameters<BundleFrameProducer["render"]>[0],
  caption: string | undefined,
  presenterAmplitude: number,
): Promise<RenderedReviewSample> {
  const rendered = await producer.render({
    ...request,
    diagnostics: true,
    presentation: { watermark: "showtell", presenterAmplitude, caption },
  });
  return {
    png: rendered.png,
    sha256: sha256(rendered.png),
    baseSha256: sha256(rendered.basePng),
    rgba: rendered.baseRgba,
  };
}

function advisoryWarning(path: string, message: string, hint: string, code = "STATIC_WEB_PIXELS"): BundleError {
  return { code, path, message, hint };
}

function writeGallery(result: BundleReviewResult): void {
  const esc = (text: string) =>
    text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const body = result.scenes
    .map((scene) =>
      [
        `<section><h2>${esc(scene.id)}</h2>`,
        ...scene.lines.map((line) =>
          [
            `<h3>${esc(line.id)} <span>${line.startMs}ms-${line.endMs}ms</span></h3>`,
            `<div class="filmstrip">`,
            ...line.samples.map(
              (sample) =>
                `<figure><img src="${esc(rel(result.outDir, sample.path))}" alt="${esc(
                  `${scene.id}/${line.id} ${sample.fraction}`,
                )}"><figcaption>${esc(sample.aspectRatio)} f=${sample.fraction.toFixed(2)} t=${Math.round(
                  sample.timeMs,
                )}ms #${sample.frame}</figcaption></figure>`,
            ),
            `</div>`,
          ].join("\n"),
        ),
        `</section>`,
      ].join("\n"),
    )
    .join("\n");
  writeFileSync(
    result.indexPath,
    `<!doctype html>
<meta charset="utf-8">
<title>Showtell Bundle Review</title>
<style>
body{margin:0;background:#111;color:#eee;font:14px system-ui,-apple-system,Segoe UI,sans-serif}
header,section{padding:24px}
h1,h2,h3{margin:0 0 12px} h3 span{color:#aaa;font-weight:400}
.filmstrip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:28px}
figure{margin:0;background:#1c1c1c;border:1px solid #333;border-radius:6px;overflow:hidden}
img{display:block;width:100%;height:auto}
figcaption{padding:8px 10px;color:#bbb;font-size:12px}
</style>
<header><h1>${esc(result.bundleDir)}</h1><p>${result.samplesPerLine} samples per line</p></header>
${body}
`,
  );
}

export async function reviewBundle(
  bundleDirInput: string,
  opts: {
    outDir?: string;
    aspectRatios?: AspectRatio[];
    cacheDir?: string;
    sceneId?: string;
    samplesPerLine?: number;
  } = {},
): Promise<BundleReviewResult> {
  const samplesPerLine = opts.samplesPerLine ?? 5;
  if (!Number.isInteger(samplesPerLine) || samplesPerLine < 2 || samplesPerLine > MAX_REVIEW_SAMPLES_PER_LINE) {
    throw new BundleReviewError(
      "Invalid --samples.",
      `Pass --samples as an integer between 2 and ${MAX_REVIEW_SAMPLES_PER_LINE}.`,
      { samplesPerLine, maxSamplesPerLine: MAX_REVIEW_SAMPLES_PER_LINE },
    );
  }
  const compiled = await compileBundle(bundleDirInput, { cacheDir: opts.cacheDir });
  const sceneIds = compiled.plan.scenes.map((scene) => scene.id);
  if (opts.sceneId && !sceneIds.includes(opts.sceneId)) {
    throw new BundleReviewError(
      `Unknown bundle scene: ${opts.sceneId}`,
      `Use --scene with one of: ${sceneIds.join(", ")}.`,
      { sceneIds },
    );
  }

  const outDir = opts.outDir ? resolve(opts.outDir) : join(compiled.bundleDir, "review");
  const frameDir = join(outDir, "frames");
  mkdirSync(frameDir, { recursive: true });
  const ratios = opts.aspectRatios ?? compiled.spec.meta.aspectRatios;
  const fractions = lineSampleFractions(samplesPerLine);
  const scenes: BundleReviewScene[] = [];
  const advisoryWarnings: BundleError[] = [];
  let totalSamples = 0;
  let staticVisualLines = 0;
  const burnInCaptions =
    compiled.plan.audio.captions.mode === "burn-in" || compiled.plan.audio.captions.mode === "sidecar-and-burn-in";
  const frameProducer = createBundleFrameProducer(compiled);

  try {
    for (const specScene of compiled.spec.scenes) {
      if (opts.sceneId && specScene.id !== opts.sceneId) continue;
      const planScene = compiled.plan.scenes.find((scene) => scene.id === specScene.id)!;
      if (specScene.visual.kind === "screencap") {
        advisoryWarnings.push(
          advisoryWarning(
            `scenes.${planScene.index}.visual`,
            "Screencap is timed media and is not sampled by the browser-motion reviewer.",
            "Render the bundle and inspect the encoded capture; browser review covers authored web frame programs.",
          ),
        );
        continue;
      }
      const reviewScene: BundleReviewScene = { id: planScene.id, index: planScene.index, lines: [] };
      for (let lineIndex = 0; lineIndex < planScene.narration.lines.length; lineIndex++) {
        const line = planScene.narration.lines[lineIndex]!;
        const samples: BundleReviewSample[] = [];
        const aspectMetrics: BundleReviewAspectMetrics[] = [];

        for (const aspectRatio of ratios) {
          let previousRgba: Buffer | undefined;
          let aspectBasePixelDeltaMax: number | undefined;
          const aspectTag = aspectRatio.replace(":", "x");
          const sampleDir = join(
            frameDir,
            aspectTag,
            `s${String(planScene.index).padStart(3, "0")}-${slug(planScene.id)}`,
            `l${String(lineIndex).padStart(2, "0")}-${slug(line.id)}`,
          );
          mkdirSync(sampleDir, { recursive: true });

          for (let sampleIndex = 0; sampleIndex < fractions.length; sampleIndex++) {
            const fraction = fractions[sampleIndex]!;
            const timeMs = lineSampleTimeMs(line, fraction, compiled.spec.meta.fps);
            const exact = exactBundleFrameAt(
              planScene,
              { timeMs, preferredLineIndex: lineIndex },
              compiled.spec.meta.fps,
            );
            let rendered: RenderedReviewSample;
            try {
              rendered = await renderReviewSample(
                frameProducer,
                { scene: specScene, compiledScene: planScene, aspectRatio, exact },
                burnInCaptions ? line.text : undefined,
                amplitudeAt(line.envelope, exact.lineMs),
              );
            } catch (error) {
              const cause = error instanceof Error ? error.message : String(error);
              const visualSrc = planScene.program.kind === "web" ? planScene.program.src : undefined;
              throw new BundleReviewError(
                `Could not render review sample for scene "${planScene.id}", line "${line.id}": ${cause}`,
                visualSrc
                  ? `Inspect ${visualSrc} at the reported timestamp, fix its deterministic visual program or inputs, then re-run bundle review.`
                  : "Inspect this scene's browser visual inputs, then re-run bundle review.",
                {
                  sceneId: planScene.id,
                  sceneIndex: planScene.index,
                  lineId: line.id,
                  lineIndex,
                  aspectRatio,
                  sampleIndex,
                  fraction,
                  timeMs: exact.timeMs,
                  frame: exact.frame,
                  visualSrc,
                  cause,
                },
              );
            }
            const delta = basePixelDelta(previousRgba, rendered.rgba);
            if (delta !== undefined) aspectBasePixelDeltaMax = Math.max(aspectBasePixelDeltaMax ?? 0, delta);
            previousRgba = rendered.rgba;

            const path = join(sampleDir, `sample-${String(sampleIndex).padStart(2, "0")}.png`);
            writeFileSync(path, rendered.png);
            samples.push({
              aspectRatio,
              fraction,
              timeMs: exact.timeMs,
              frame: exact.frame,
              path,
              sha256: rendered.sha256,
              baseSha256: rendered.baseSha256,
              basePixelDeltaFromPrevious: delta,
            });
            totalSamples++;
          }

          aspectMetrics.push({
            aspectRatio,
            basePixelDeltaMax: aspectBasePixelDeltaMax,
          });
        }

        const warnings: BundleError[] = [];
        const basePixelDeltaMax = aspectMetrics.reduce<number | undefined>(
          (max, metric) =>
            metric.basePixelDeltaMax === undefined ? max : Math.max(max ?? 0, metric.basePixelDeltaMax),
          undefined,
        );
        if (planScene.program.kind === "web") {
          const staticAspects = aspectMetrics.filter((metric) => (metric.basePixelDeltaMax ?? 0) < 0.0001);
          if (staticAspects.length > 0) {
            for (const metric of staticAspects) {
              const warning = advisoryWarning(
                `scenes.${planScene.index}.narration.lines.${lineIndex}.${metric.aspectRatio}`,
                "Sampled browser pixels were effectively static within this narration line.",
                "Inspect the filmstrip and seek the paused GSAP timeline through a declared semantic range if motion was intended.",
              );
              warnings.push(warning);
              advisoryWarnings.push(warning);
            }
            staticVisualLines++;
          }
        }

        reviewScene.lines.push({
          id: line.id,
          index: lineIndex,
          startMs: line.startMs,
          endMs: line.endMs,
          durationMs: line.durationMs,
          samples,
          advisory: {
            basePixelDeltaMax,
            aspectMetrics,
            warnings,
          },
        });
      }
      scenes.push(reviewScene);
    }

    const manifestPath = join(outDir, "review-manifest.json");
    const indexPath = join(outDir, "index.html");
    const result: BundleReviewResult = {
      ok: true,
      stage: "bundle-review",
      bundleDir: compiled.bundleDir,
      outDir,
      indexPath,
      manifestPath,
      samplesPerLine,
      aspectRatios: ratios,
      scenes,
      advisory: {
        warnings: advisoryWarnings,
        metrics: {
          totalSamples,
          staticVisualLines,
        },
      },
    };
    writeFileSync(manifestPath, JSON.stringify(result, null, 2) + "\n");
    writeGallery(result);
    return result;
  } finally {
    await frameProducer.close();
  }
}
