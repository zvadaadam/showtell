import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { ChartScene, CodeScene, DiffScene, ResolvedCode, ResolvedDiff } from "@agent-video/core";
import type {
  HyperframeElement,
  HyperframeTheme,
  ResolvedAsset,
  ResolvedCode as HyperResolvedCode,
  ResolvedDiff as HyperResolvedDiff,
} from "@agent-video/hyperframes";
import { roundRect } from "./draw.ts";
import type { Dims } from "./dims.ts";
import { tokenize } from "./highlight.ts";
import { drawChart } from "./primitives/chart.ts";
import { drawCode } from "./primitives/code.ts";
import { drawDiff } from "./primitives/diff.ts";
import { clamp01, easeOutCubic, type MotionClock } from "./hyperframe/motion.ts";
import { emptyResult, panelRadius, propsOf, type Box, type DrawResult } from "./render-hyperframe-shared.ts";
import { canvasTheme } from "./theme.ts";

interface MediaRenderEnv {
  dims: Dims;
  palette: {
    panel: string;
    border: string;
  };
  theme?: HyperframeTheme;
  /** Present for animated frames; media defaults its reveals from this clock. */
  motion?: MotionClock;
}

/** Author-set reveal wins; otherwise animated frames sweep content in on scene entry. */
function mediaReveal(
  props: Record<string, unknown>,
  env: MediaRenderEnv,
  delayMs: number,
  durationMs: number,
): number | undefined {
  if (typeof props.reveal === "number") return props.reveal;
  if (!env.motion) return undefined;
  return easeOutCubic(clamp01((env.motion.sceneMs - delayMs) / durationMs));
}

interface PngCanvas {
  toBuffer(mimeType?: "image/png"): Buffer;
}

type HyperResolvedDiffWithLines = HyperResolvedDiff & Pick<ResolvedDiff, "lines" | "language" | "rawText">;

async function drawCanvasInto(ctx: SKRSContext2D, source: PngCanvas, box: Box): Promise<void> {
  const image = await loadImage(source.toBuffer("image/png"));
  ctx.drawImage(image, box.x, box.y, box.w, box.h);
}

function drawPanel(ctx: SKRSContext2D, box: Box, env: MediaRenderEnv): void {
  const r = panelRadius(box);
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.fillStyle = env.palette.panel;
  ctx.fill();
  ctx.strokeStyle = env.palette.border;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export async function renderCodeRef(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: MediaRenderEnv,
): Promise<DrawResult> {
  const props = propsOf(element);
  const source = props.source as HyperResolvedCode | undefined;
  if (!source || source.kind !== "code") return emptyResult();
  const theme = canvasTheme(env.theme);
  const canvas = createCanvas(Math.max(2, Math.round(box.w)), Math.max(2, Math.round(box.h)));
  const c = canvas.getContext("2d");
  const dims = { width: canvas.width, height: canvas.height };
  const startLine = source.lineStart ?? 1;
  const lineCount = source.text ? source.text.split("\n").length : 1;
  const resolved: ResolvedCode = {
    text: source.text,
    language: source.language ?? "text",
    startLine,
    endLine: source.lineEnd ?? startLine + lineCount - 1,
    focus: (props.focus as number[] | undefined) ?? source.focus ?? [],
  };
  const scene: CodeScene = {
    kind: "code",
    content: {
      file: source.file,
      ref: source.ref,
      lineStart: source.lineStart,
      lineEnd: source.lineEnd,
      focus: resolved.focus,
      language: resolved.language,
    },
    narration: "",
    duration: "auto",
  };
  const tokens = await tokenize(resolved.text, resolved.language, theme.shikiTheme);
  drawCode(c, scene, resolved, tokens, dims, {
    maxLines: typeof props.maxLines === "number" ? props.maxLines : undefined,
    reveal: mediaReveal(props, env, 250, 1300),
    theme,
  });
  await drawCanvasInto(ctx, canvas, box);
  return { resolvedRefs: [{ file: source.file, text: source.text }] };
}

export async function renderDiffRef(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: MediaRenderEnv,
): Promise<DrawResult> {
  const props = propsOf(element);
  const source = props.source as HyperResolvedDiffWithLines | undefined;
  if (!source || source.kind !== "diff") return emptyResult();
  const theme = canvasTheme(env.theme);
  const canvas = createCanvas(Math.max(2, Math.round(box.w)), Math.max(2, Math.round(box.h)));
  const c = canvas.getContext("2d");
  const dims = { width: canvas.width, height: canvas.height };
  const diff: ResolvedDiff = {
    file: source.file,
    language: source.language ?? "text",
    lines: source.lines ?? [],
    added: source.added,
    removed: source.removed,
    rawText: source.rawText ?? source.text,
  };
  const scene: DiffScene = {
    kind: "diff",
    content: { file: source.file, ref: source.ref, animation: "magic-move" },
    narration: "",
    duration: "auto",
  };
  const focus =
    props.focus === "file" || props.focus === "changed" || Array.isArray(props.focus) ? props.focus : undefined;
  drawDiff(c, scene, diff, dims, {
    focus,
    reveal: mediaReveal(props, env, 250, 1300),
    theme,
  });
  await drawCanvasInto(ctx, canvas, box);
  const warning =
    diff.added === 0 && diff.removed === 0
      ? `diff scene for ${source.file} at ref "${source.ref}" is EMPTY (+0 -0).`
      : undefined;
  return { resolvedRefs: [{ file: source.file, text: diff.rawText }], warning };
}

function asChartRows(data: unknown): Record<string, string | number>[] {
  if (!Array.isArray(data)) return [];
  const rows: Record<string, string | number>[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" || typeof value === "number") out[key] = value;
    }
    if (Object.keys(out).length > 0) rows.push(out);
  }
  return rows;
}

export async function renderChart(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: MediaRenderEnv,
): Promise<DrawResult> {
  const props = propsOf(element);
  const rows = asChartRows(props.data);
  const reveal = typeof props.reveal === "number" ? Math.max(0, Math.min(1, props.reveal)) : undefined;
  const visibleRows = reveal === undefined ? rows : rows.slice(0, Math.max(1, Math.ceil(rows.length * reveal)));
  const canvas = createCanvas(Math.max(2, Math.round(box.w)), Math.max(2, Math.round(box.h)));
  const c = canvas.getContext("2d");
  const dims = { width: canvas.width, height: canvas.height };
  drawPanel(c, { x: 0, y: 0, w: dims.width, h: dims.height }, env);
  const scene: ChartScene = {
    kind: "chart",
    content: {
      chartType: props.type === "line" || props.type === "pie" || props.type === "bar" ? props.type : "bar",
      title: typeof props.title === "string" ? props.title : undefined,
      x: typeof props.x === "string" ? props.x : undefined,
      y: typeof props.y === "string" ? props.y : undefined,
      data: visibleRows,
    },
    narration: "",
    duration: "auto",
  };
  const hasData = drawChart(
    c,
    scene,
    dims,
    canvasTheme(env.theme),
    env.motion ? { sceneMs: env.motion.sceneMs } : undefined,
  );
  await drawCanvasInto(ctx, canvas, box);
  return { resolvedRefs: [], warning: hasData ? undefined : "chart scene has no numeric data to plot." };
}

export async function renderImageAsset(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: MediaRenderEnv,
): Promise<DrawResult> {
  const props = propsOf(element);
  const asset = props.asset as ResolvedAsset | undefined;
  if (!asset || asset.type !== "image") return emptyResult();
  drawPanel(ctx, box, env);
  let image;
  try {
    image = await loadImage(asset.path);
  } catch {
    return {
      resolvedRefs: [],
      warning: `image asset "${asset.path}" could not be loaded.`,
    };
  }
  const cover = props.fit === "cover";
  const scale = cover
    ? Math.max(box.w / image.width, box.h / image.height)
    : Math.min(box.w / image.width, box.h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, panelRadius(box));
  ctx.clip();
  ctx.drawImage(image, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  ctx.restore();
  return emptyResult();
}
