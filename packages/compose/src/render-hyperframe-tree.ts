/**
 * Render an executed hyperframe element tree into deterministic pixels.
 *
 * This module owns layout (stack/grid/panel measurement, overflow handling,
 * surplus centering) and the component registry. The design language lives in
 * ./hyperframe/: tokens (palette + treatments), typography (type scale),
 * atoms, rails, and overlay (background + captions).
 */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { AspectRatio } from "@agent-video/core";
import {
  CaptionDeck,
  CompareSplit,
  DecisionGrid,
  LaneStack,
  PhaseBanner,
  ProofLadder,
  SignalWall,
  StatRow,
  StatusRail,
  type CaptionCue,
  type HyperframeChild,
  type HyperframeComponent,
  type HyperframeElement,
  type HyperframeTheme,
} from "@agent-video/hyperframes";
import { dimsFor, type Dims } from "./dims.ts";
import { drawWatermark, roundRect } from "./draw.ts";
import { ensureFonts } from "./fonts.ts";
import {
  badgeChipSpec,
  badgeChipWidth,
  drawBadge,
  drawCallout,
  drawDivider,
  drawLowerThird,
  drawMeter,
  drawTextNode,
  estimateCalloutHeight,
  estimateLowerThirdHeight,
  estimateMeterHeight,
  estimateTextHeight,
} from "./hyperframe/atoms.ts";
import { drawFormula, drawFunctionPlot, estimateFormulaHeight } from "./hyperframe/plot.ts";
import {
  drawBigStat,
  drawChecklist,
  drawQuote,
  drawTravelPath,
  estimateBigStatHeight,
  estimateChecklistHeight,
  estimateQuoteHeight,
} from "./hyperframe/blocks.ts";
import { elementChildElements, elementChildren, isElement } from "./hyperframe/element.ts";
import { easeOutCubic, enter01, type MotionClock } from "./hyperframe/motion.ts";
import { collectKineticCaptions, drawKineticCaption, drawStageBackground } from "./hyperframe/overlay.ts";
import { drawSystemMap, drawTimelineRail } from "./hyperframe/rails.ts";
import { gapPx, paddingPx, paletteFor, rgba, toneColor, TOKENS, type RenderEnv } from "./hyperframe/tokens.ts";
import { layoutText, drawLaidOutText, type LaidOutText } from "./hyperframe/typography.ts";
import { renderChart, renderCodeRef, renderDiffRef, renderImageAsset } from "./render-hyperframe-media.ts";
import { emptyResult, panelRadius, propsOf, type Box, type DrawResult } from "./render-hyperframe-shared.ts";
import type { RenderedScene } from "./render-scene.ts";
import { canvasTheme } from "./theme.ts";

interface ComponentRenderer {
  estimateHeight?: (ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv) => number | undefined;
  draw: (ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv) => DrawResult | Promise<DrawResult>;
}

export interface HyperframeTreeRenderOpts {
  aspectRatio: AspectRatio;
  activeCue?: CaptionCue;
  theme?: HyperframeTheme;
  watermark?: string | false;
  /** Present when rendering an animated video frame; stills render end states. */
  motion?: MotionClock;
}

/* ------------------------------------------------------------------ */
/* Estimation                                                          */
/* ------------------------------------------------------------------ */

function estimateStackHeight(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): number | undefined {
  const props = propsOf(element);
  const children = elementChildElements(element).filter((child) => child.type !== "KineticCaption");
  if (children.length === 0) return 0;
  const base = Math.min(env.dims.width, env.dims.height);
  const gap = gapPx(props.gap, base);
  if (props.direction === "horizontal") {
    const childW = Math.max(1, (box.w - gap * (children.length - 1)) / children.length);
    let max = 0;
    for (const child of children) {
      const h = estimateHeight(ctx, child, { ...box, w: childW }, env);
      if (h === undefined) return undefined;
      max = Math.max(max, h);
    }
    return max;
  }
  let total = gap * (children.length - 1);
  for (const child of children) {
    const h = estimateHeight(ctx, child, box, env);
    if (h === undefined) return undefined;
    total += h;
  }
  return total;
}

function estimateGridHeight(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): number | undefined {
  const children = elementChildElements(element);
  if (children.length === 0) return 0;
  const props = propsOf(element);
  const columns = typeof props.columns === "number" && props.columns > 0 ? props.columns : 2;
  const base = Math.min(env.dims.width, env.dims.height);
  const gap = gapPx(props.gap, base);
  const rows = Math.ceil(children.length / columns);
  const cellW = Math.max(1, (box.w - gap * (columns - 1)) / columns);
  const rowHeights = Array.from({ length: rows }, () => 0);
  for (let i = 0; i < children.length; i++) {
    const h = estimateHeight(ctx, children[i]!, { ...box, w: cellW }, env);
    if (h === undefined) return undefined;
    const row = Math.floor(i / columns);
    rowHeights[row] = Math.max(rowHeights[row]!, h);
  }
  return rowHeights.reduce((sum, h) => sum + h, 0) + gap * (rows - 1);
}

interface PanelMetrics {
  pad: number;
  titleBlock: { title?: LaidOutText; subtitle?: LaidOutText; height: number };
  contentGap: number;
}

function panelMetrics(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): PanelMetrics {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const pad = paddingPx(props.padding ?? "sm", Math.min(box.w, box.h));
  const innerW = Math.max(1, box.w - pad * 2);
  const title = typeof props.title === "string" ? layoutText(ctx, env, "section", props.title, innerW) : undefined;
  const subtitle =
    typeof props.subtitle === "string" ? layoutText(ctx, env, "caption", props.subtitle, innerW) : undefined;
  const spacing = Math.round(base * 0.008);
  let height = 0;
  if (title) height += title.height;
  if (title && subtitle) height += spacing;
  if (subtitle) height += subtitle.height;
  return { pad, titleBlock: { title, subtitle, height }, contentGap: Math.round(base * 0.018) };
}

function panelBadgeRow(children: HyperframeElement[]): boolean {
  return children.length > 1 && children[0]?.type === "Badge" && children.slice(1).every((c) => c.type === "Text");
}

interface PanelContentMetrics {
  badgeRow: boolean;
  /** Natural children height; undefined when a growing child should fill the card. */
  childrenH: number | undefined;
  /** Height of the text column beside the badge (badge-row layout only). */
  badgeTextH: number;
}

/**
 * The ONE measurement of a panel's children (badge-row detection, text-column
 * width, gap accumulation). estimatePanelHeight and renderPanel both call this
 * so the estimate can never drift from the drawn pixels.
 */
function panelContentMetrics(
  ctx: SKRSContext2D,
  children: HyperframeElement[],
  childBox: Box,
  env: RenderEnv,
): PanelContentMetrics {
  const base = Math.min(env.dims.width, env.dims.height);
  const badgeRow = panelBadgeRow(children);
  const childHeights = children.map((child) => estimateHeight(ctx, child, childBox, env));
  if (badgeRow && childHeights.every((h): h is number => typeof h === "number")) {
    const badgeW = badgeChipWidth(ctx, env, children[0]!) + Math.round(base * 0.018);
    const textBox = { ...childBox, w: Math.max(1, childBox.w - badgeW) };
    const textHeights = children.slice(1).map((text) => estimateHeight(ctx, text, textBox, env) ?? 0);
    const badgeTextH =
      textHeights.reduce((sum, h) => sum + h, 0) + gapPx("xs", base) * Math.max(0, textHeights.length - 1);
    return { badgeRow, childrenH: Math.max(childHeights[0]!, badgeTextH), badgeTextH };
  }
  if (childHeights.every((h): h is number => typeof h === "number")) {
    return {
      badgeRow,
      childrenH: childHeights.reduce((sum, h) => sum + h, 0) + gapPx("xs", base) * (children.length - 1),
      badgeTextH: 0,
    };
  }
  return { badgeRow, childrenH: undefined, badgeTextH: 0 };
}

function estimatePanelHeight(ctx: SKRSContext2D, child: HyperframeElement, box: Box, env: RenderEnv): number {
  const base = Math.min(env.dims.width, env.dims.height);
  const metrics = panelMetrics(ctx, child, box, env);
  const pad = metrics.pad;
  let height = pad * 2 + metrics.titleBlock.height;
  const children = elementChildElements(child);
  let compactRow = false;
  if (children.length > 0) {
    if (metrics.titleBlock.height > 0) height += metrics.contentGap;
    const childBox = { ...box, w: Math.max(1, box.w - pad * 2), h: Math.max(1, box.h - pad * 2) };
    const content = panelContentMetrics(ctx, children, childBox, env);
    compactRow = content.badgeRow && content.childrenH !== undefined;
    height += content.childrenH ?? base * 0.28;
  }
  return Math.min(box.h, Math.max(base * (compactRow ? 0.09 : 0.14), height));
}

function estimateHeight(ctx: SKRSContext2D, child: HyperframeElement, box: Box, env: RenderEnv): number | undefined {
  const props = propsOf(child);
  if (props.grow) return undefined;
  return COMPONENT_RENDERERS[child.type]?.estimateHeight?.(ctx, child, box, env);
}

function mergeResult(target: DrawResult, source: DrawResult): void {
  target.resolvedRefs.push(...source.resolvedRefs);
  target.warning = target.warning ?? source.warning;
}

/* ------------------------------------------------------------------ */
/* Containers                                                          */
/* ------------------------------------------------------------------ */

async function renderPanel(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  const result = emptyResult();
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const tone = typeof props.tone === "string" && props.tone !== "default" ? props.tone : undefined;
  const colors = toneColor(props.tone, env);
  const radius = panelRadius(box);
  const panelTokens = TOKENS.panel;

  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  const fill = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  if (env.palette.isLight) {
    fill.addColorStop(0, rgba(env.palette.surface, panelTokens.fillTopLight));
    fill.addColorStop(1, rgba(env.palette.surface, panelTokens.fillBottomLight));
  } else {
    fill.addColorStop(0, rgba(env.palette.surface, panelTokens.fillTopDark));
    fill.addColorStop(1, rgba(env.palette.surface, panelTokens.fillBottomDark));
  }
  ctx.fillStyle = fill;
  ctx.fill();
  if (tone) {
    roundRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fillStyle = colors.fill;
    ctx.fill();
  }
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.strokeStyle = tone ? colors.stroke : env.palette.border;
  ctx.lineWidth = tone ? 2 : 1.5;
  ctx.stroke();
  if (!env.palette.isLight) {
    ctx.beginPath();
    ctx.moveTo(box.x + radius, box.y + 1);
    ctx.lineTo(box.x + box.w - radius, box.y + 1);
    ctx.strokeStyle = `rgba(255, 255, 255, ${panelTokens.topHighlight})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (tone) {
    const barW = Math.max(4, Math.round(base * panelTokens.accentBarWidth));
    const inset = Math.round(radius * 0.9);
    roundRect(ctx, box.x, box.y + inset, barW, Math.max(barW, box.h - inset * 2), barW / 2);
    ctx.fillStyle = colors.fg;
    ctx.fill();
  }

  const metrics = panelMetrics(ctx, element, box, env);
  const pad = metrics.pad;
  const innerX = box.x + pad;
  const innerW = Math.max(1, box.w - pad * 2);
  const innerH = Math.max(1, box.h - pad * 2);
  const children = elementChildElements(element);

  // Natural content height → vertical centering inside the card. Children get
  // a box of exactly their natural height so the inner stack doesn't re-center.
  let contentH = metrics.titleBlock.height;
  const childBox = { x: innerX, y: box.y + pad, w: innerW, h: innerH };
  const badgeRow = panelBadgeRow(children);
  let childrenH: number | undefined = 0;
  let badgeTextH = 0;
  if (children.length > 0) {
    if (metrics.titleBlock.height > 0) contentH += metrics.contentGap;
    const childHeights = children.map((child) => estimateHeight(ctx, child, childBox, env));
    if (badgeRow && childHeights.every((h): h is number => typeof h === "number")) {
      const badgeW = badgeChipWidth(ctx, env, children[0]!) + Math.round(base * 0.018);
      const textBox = { ...childBox, w: Math.max(1, innerW - badgeW) };
      const textHeights = children.slice(1).map((text) => estimateHeight(ctx, text, textBox, env) ?? 0);
      badgeTextH = textHeights.reduce((sum, h) => sum + h, 0) + gapPx("xs", base) * Math.max(0, textHeights.length - 1);
      childrenH = Math.max(childHeights[0]!, badgeTextH);
    } else if (childHeights.every((h): h is number => typeof h === "number")) {
      childrenH =
        childHeights.reduce<number>((sum, h) => sum + (h ?? 0), 0) + gapPx("xs", base) * (children.length - 1);
    } else {
      childrenH = undefined; // growing content fills the card
    }
    contentH = childrenH === undefined ? innerH : contentH + childrenH;
  }

  let y = box.y + pad + Math.max(0, (innerH - contentH) / 2);

  ctx.save();
  roundRect(ctx, box.x + 2, box.y + 2, Math.max(1, box.w - 4), Math.max(1, box.h - 4), Math.max(1, radius - 2));
  ctx.clip();

  if (metrics.titleBlock.title) {
    drawLaidOutText(ctx, env, metrics.titleBlock.title, innerX, y, env.palette.fg);
    y += metrics.titleBlock.title.height;
    if (metrics.titleBlock.subtitle) y += Math.round(base * 0.008);
  }
  if (metrics.titleBlock.subtitle) {
    drawLaidOutText(ctx, env, metrics.titleBlock.subtitle, innerX, y, env.palette.subtle);
    y += metrics.titleBlock.subtitle.height;
  }
  if (children.length > 0) {
    if (metrics.titleBlock.height > 0) y += metrics.contentGap;
    const remaining = Math.max(1, box.y + box.h - pad - y);
    if (badgeRow) {
      const badgeW = badgeChipWidth(ctx, env, children[0]!);
      const badgeH = badgeChipSpec(ctx, env, children[0]!).chipH;
      mergeResult(result, await renderNode(ctx, children[0]!, { x: innerX, y, w: badgeW, h: badgeH }, env));
      const textX = innerX + badgeW + Math.round(base * 0.018);
      mergeResult(
        result,
        await renderStack(
          ctx,
          { ...element, type: "Stack", props: { direction: "vertical", gap: "xs" }, children: children.slice(1) },
          { x: textX, y, w: Math.max(1, innerX + innerW - textX), h: Math.min(remaining, Math.max(1, badgeTextH)) },
          env,
        ),
      );
    } else {
      mergeResult(
        result,
        await renderStack(
          ctx,
          { ...element, type: "Stack", props: { direction: "vertical", gap: "xs", grow: true }, children },
          { x: innerX, y, w: innerW, h: childrenH === undefined ? remaining : Math.min(remaining, childrenH) },
          env,
        ),
      );
    }
  }
  ctx.restore();
  return result;
}

async function renderStack(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  const result = emptyResult();
  const children = elementChildElements(element).filter((child) => child.type !== "KineticCaption");
  if (children.length === 0) return result;
  const base = Math.min(env.dims.width, env.dims.height);
  const props = propsOf(element);
  const gap = gapPx(props.gap, base);
  const direction = props.direction === "horizontal" ? "horizontal" : "vertical";
  if (direction === "horizontal") {
    const childW = (box.w - gap * (children.length - 1)) / children.length;
    for (let i = 0; i < children.length; i++) {
      mergeResult(
        result,
        await renderNode(ctx, children[i]!, { x: box.x + i * (childW + gap), y: box.y, w: childW, h: box.h }, env),
      );
    }
    return result;
  }

  const avail = box.h - gap * (children.length - 1);
  let fixed = children.map((child) => estimateHeight(ctx, child, box, env));
  let fixedTotal = fixed.reduce<number>((sum, height) => sum + (height ?? 0), 0);
  const flexCount = fixed.filter((height) => height === undefined).length;

  let y = box.y;
  let flexH = 0;
  if (flexCount > 0) {
    flexH = Math.max(1, (avail - fixedTotal) / flexCount);
  } else if (fixedTotal > avail) {
    // Content is taller than the box: compress uniformly instead of overlapping.
    const scale = avail / fixedTotal;
    fixed = fixed.map((height) => (height === undefined ? undefined : height * scale));
    fixedTotal = avail;
  } else {
    y += (avail - fixedTotal) / 2; // center surplus
  }

  const clipPad = Math.max(2, Math.round(gap * 0.45));
  const rise = Math.round(base * TOKENS.motion.riseFraction);
  for (let i = 0; i < children.length; i++) {
    const h = fixed[i] ?? flexH;
    const childBox = { x: box.x, y, w: box.w, h };
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x - clipPad, y - clipPad, box.w + clipPad * 2, h + clipPad * 2 + rise);
    ctx.clip();
    // Staggered entrance: children fade in and settle upward at scene start.
    const t = easeOutCubic(enter01(env, i * TOKENS.motion.staggerMs, TOKENS.motion.enterMs));
    if (t < 1) {
      ctx.globalAlpha *= t;
      ctx.translate(0, (1 - t) * rise);
    }
    mergeResult(result, await renderNode(ctx, children[i]!, childBox, env));
    ctx.restore();
    y += h + gap;
  }
  return result;
}

async function renderGrid(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  const result = emptyResult();
  const children = elementChildElements(element);
  if (children.length === 0) return result;
  const props = propsOf(element);
  const columns = typeof props.columns === "number" && props.columns > 0 ? props.columns : 2;
  const base = Math.min(env.dims.width, env.dims.height);
  const gap = gapPx(props.gap, base);
  const rows = Math.ceil(children.length / columns);
  const cellW = (box.w - gap * (columns - 1)) / columns;
  const fillCellH = (box.h - gap * (rows - 1)) / rows;

  const rise = Math.round(base * TOKENS.motion.riseFraction);
  const drawCell = async (index: number, x: number, y: number, w: number, h: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 2, y - 2, w + 4, h + 4 + rise);
    ctx.clip();
    const t = easeOutCubic(enter01(env, index * TOKENS.motion.staggerMs, TOKENS.motion.enterMs));
    if (t < 1) {
      ctx.globalAlpha *= t;
      ctx.translate(0, (1 - t) * rise);
    }
    mergeResult(result, await renderNode(ctx, children[index]!, { x, y, w, h }, env));
    ctx.restore();
  };

  if (!props.grow) {
    const naturalRows = Array.from({ length: rows }, () => 0);
    let hasNaturalRows = true;
    for (let i = 0; i < children.length; i++) {
      const height = estimateHeight(ctx, children[i]!, { x: box.x, y: box.y, w: cellW, h: fillCellH }, env);
      if (height === undefined) {
        hasNaturalRows = false;
        break;
      }
      naturalRows[Math.floor(i / columns)] = Math.max(naturalRows[Math.floor(i / columns)]!, height);
    }
    const naturalTotal = naturalRows.reduce((sum, h) => sum + h, 0) + gap * (rows - 1);
    if (hasNaturalRows && naturalTotal <= box.h) {
      // Give breathing room back to the cards: stretch rows up to 40% beyond
      // natural height when the grid has surplus, then center the remainder.
      const surplus = box.h - naturalTotal;
      const stretch = Math.min(surplus / rows, (naturalTotal / rows) * 0.4);
      const rowHeights = naturalRows.map((h) => h + stretch);
      const total = rowHeights.reduce((sum, h) => sum + h, 0) + gap * (rows - 1);
      let y = box.y + (box.h - total) / 2;
      for (let row = 0; row < rows; row++) {
        const rowH = rowHeights[row]!;
        for (let col = 0; col < columns; col++) {
          const index = row * columns + col;
          if (index >= children.length) break;
          await drawCell(index, box.x + col * (cellW + gap), y, cellW, rowH);
        }
        y += rowH + gap;
      }
      return result;
    }
  }
  for (let i = 0; i < children.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    await drawCell(i, box.x + col * (cellW + gap), box.y + row * (fillCellH + gap), cellW, fillCellH);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Leaf adapters                                                       */
/* ------------------------------------------------------------------ */

function leaf(draw: (ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv) => void) {
  return (ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): DrawResult => {
    draw(ctx, element, box, env);
    return emptyResult();
  };
}

function renderCalloutNode(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): DrawResult {
  if (propsOf(element).when === false) return emptyResult();
  drawCallout(ctx, element, box, env);
  return emptyResult();
}

function renderCaptionSafeAreaNode(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  const safe = Math.round(Math.min(env.dims.width, env.dims.height) * TOKENS.captionSafeArea);
  return renderStack(
    ctx,
    { ...element, type: "Stack", props: { direction: "vertical", gap: "md", grow: true } },
    { ...box, h: Math.max(1, box.h - safe) },
    env,
  );
}

function unknownElementError(element: HyperframeElement): Error {
  return new Error(
    `Unknown hyperframe element "${element.type}". Import a supported component from @agent-video/hyperframes.`,
  );
}

function renderUnsupportedNode(
  _ctx: SKRSContext2D,
  element: HyperframeElement,
  _box: Box,
  _env: RenderEnv,
): DrawResult {
  throw unknownElementError(element);
}

async function renderNode(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  if (box.w <= 1 || box.h <= 1) return emptyResult();
  const renderer = COMPONENT_RENDERERS[element.type];
  if (!renderer) throw unknownElementError(element);
  return renderer.draw(ctx, element, box, env);
}

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

async function renderStage(ctx: SKRSContext2D, element: HyperframeElement, env: RenderEnv): Promise<DrawResult> {
  const props = propsOf(element);
  const tone = typeof props.tone === "string" ? props.tone : "dark";
  const stageEnv: RenderEnv = { ...env, palette: paletteFor(tone, env.theme) };
  drawStageBackground(ctx, stageEnv.dims, stageEnv);
  const base = Math.min(stageEnv.dims.width, stageEnv.dims.height);
  const pad = paddingPx(props.padding, base);
  const content: HyperframeElement = {
    type: "Stack",
    props: { direction: "vertical", gap: "md", grow: true },
    children: elementChildren(element).filter((child) => !(isElement(child) && child.type === "KineticCaption")),
  };
  const result = await renderStack(
    ctx,
    content,
    { x: pad, y: pad, w: stageEnv.dims.width - pad * 2, h: stageEnv.dims.height - pad * 2 },
    stageEnv,
  );
  for (const caption of collectKineticCaptions(element)) drawKineticCaption(ctx, caption, stageEnv);
  return result;
}

function minHeight(px: number, multiplier: number): ComponentRenderer["estimateHeight"] {
  return (_ctx, _element, _box, env) =>
    Math.max(px, Math.round(Math.min(env.dims.width, env.dims.height) * multiplier));
}

function renderComposite<Props extends object>(component: HyperframeComponent<Props>): ComponentRenderer {
  const expand = (element: HyperframeElement) =>
    component({ ...propsOf(element), children: element.children } as Props & { children?: HyperframeChild });
  return {
    estimateHeight: (ctx, element, box, env) => estimateHeight(ctx, expand(element), box, env),
    draw: (ctx, element, box, env) => renderNode(ctx, expand(element), box, env),
  };
}

const COMPONENT_RENDERERS: Record<string, ComponentRenderer> = {
  Stage: {
    draw: (ctx, element, _box, env) => renderStage(ctx, element, env),
  },
  Stack: {
    estimateHeight: estimateStackHeight,
    draw: renderStack,
  },
  Grid: {
    estimateHeight: estimateGridHeight,
    draw: renderGrid,
  },
  Text: {
    estimateHeight: estimateTextHeight,
    draw: leaf(drawTextNode),
  },
  CodeRef: {
    draw: renderCodeRef,
  },
  DiffRef: {
    draw: renderDiffRef,
  },
  Chart: {
    draw: renderChart,
  },
  ImageAsset: {
    draw: renderImageAsset,
  },
  Callout: {
    estimateHeight: estimateCalloutHeight,
    draw: renderCalloutNode,
  },
  CaptionSafeArea: {
    draw: renderCaptionSafeAreaNode,
  },
  KineticCaption: {
    estimateHeight: () => 0,
    draw: renderUnsupportedNode,
  },
  LowerThird: {
    estimateHeight: estimateLowerThirdHeight,
    draw: leaf(drawLowerThird),
  },
  TimelineRail: {
    estimateHeight: minHeight(64, 0.085),
    draw: leaf(drawTimelineRail),
  },
  SystemMap: {
    draw: leaf(drawSystemMap),
  },
  Panel: {
    estimateHeight: estimatePanelHeight,
    draw: renderPanel,
  },
  Badge: {
    estimateHeight: minHeight(30, 0.034),
    draw: leaf(drawBadge),
  },
  Divider: {
    estimateHeight: minHeight(28, 0.05),
    draw: leaf(drawDivider),
  },
  Meter: {
    estimateHeight: estimateMeterHeight,
    draw: leaf(drawMeter),
  },
  BigStat: {
    estimateHeight: estimateBigStatHeight,
    draw: leaf(drawBigStat),
  },
  Checklist: {
    estimateHeight: estimateChecklistHeight,
    draw: leaf(drawChecklist),
  },
  Quote: {
    estimateHeight: estimateQuoteHeight,
    draw: leaf(drawQuote),
  },
  TravelPath: {
    draw: leaf(drawTravelPath),
  },
  FunctionPlot: {
    draw: leaf(drawFunctionPlot),
  },
  Formula: {
    estimateHeight: estimateFormulaHeight,
    draw: leaf(drawFormula),
  },
  PhaseBanner: renderComposite(PhaseBanner),
  SignalWall: renderComposite(SignalWall),
  LaneStack: renderComposite(LaneStack),
  DecisionGrid: renderComposite(DecisionGrid),
  ProofLadder: renderComposite(ProofLadder),
  StatusRail: renderComposite(StatusRail),
  CaptionDeck: renderComposite(CaptionDeck),
  StatRow: renderComposite(StatRow),
  CompareSplit: renderComposite(CompareSplit),
};

export const RENDERABLE_COMPONENT_TYPES = Object.freeze(Object.keys(COMPONENT_RENDERERS)) as readonly string[];

async function renderHyperframeElementToCanvas(element: HyperframeElement, opts: HyperframeTreeRenderOpts) {
  ensureFonts();
  const dims: Dims = dimsFor(opts.aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  const env: RenderEnv = {
    dims,
    palette: paletteFor("dark", opts.theme),
    activeCue: opts.activeCue,
    theme: opts.theme,
    motion: opts.motion,
  };
  const result =
    element.type === "Stage"
      ? await renderStage(ctx, element, env)
      : await renderNode(ctx, element, { x: 0, y: 0, w: dims.width, h: dims.height }, env);

  if (opts.watermark !== false) drawWatermark(ctx, dims, opts.watermark ?? "agent-video.dev", canvasTheme(opts.theme));
  return { canvas, ctx, dims, result };
}

export async function renderHyperframeElementToPng(
  element: HyperframeElement,
  opts: HyperframeTreeRenderOpts,
): Promise<RenderedScene> {
  const { canvas, dims, result } = await renderHyperframeElementToCanvas(element, opts);
  return {
    png: canvas.toBuffer("image/png"),
    width: dims.width,
    height: dims.height,
    resolvedRefs: result.resolvedRefs,
    warning: result.warning,
  };
}

export interface RenderedHyperframeFrame {
  /** Raw RGBA pixels, row-major, suitable for an ffmpeg rawvideo pipe. */
  rgba: Buffer;
  width: number;
  height: number;
}

/**
 * Render one animated video frame as raw RGBA. `drawOverlay` runs after the
 * tree (and watermark) so callers can burn in canonical captions per frame.
 */
export async function renderHyperframeElementToRgba(
  element: HyperframeElement,
  opts: HyperframeTreeRenderOpts & {
    drawOverlay?: (ctx: SKRSContext2D, dims: Dims) => void;
  },
): Promise<RenderedHyperframeFrame> {
  const { canvas, ctx, dims } = await renderHyperframeElementToCanvas(element, opts);
  opts.drawOverlay?.(ctx, dims);
  return { rgba: canvas.data(), width: dims.width, height: dims.height };
}
