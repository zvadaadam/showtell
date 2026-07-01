/** Render an executed hyperframe element tree into deterministic pixels. */
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { AspectRatio } from "@agent-video/core";
import type { CaptionCue, HyperframeTheme, HyperframeChild, HyperframeElement } from "@agent-video/hyperframes";
import { dimsFor, type Dims } from "./dims.ts";
import { drawBackground, drawWatermark, roundRect, wrapText } from "./draw.ts";
import { ensureFonts } from "./fonts.ts";
import { renderChart, renderCodeRef, renderDiffRef, renderImageAsset } from "./render-hyperframe-media.ts";
import { canvasTheme, THEME } from "./theme.ts";
import type { RenderedScene } from "./render-scene.ts";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Palette {
  fg: string;
  subtle: string;
  accent: string;
  success: string;
  warning: string;
  panel: string;
  border: string;
}

interface RenderEnv {
  dims: Dims;
  palette: Palette;
  activeCue?: CaptionCue;
  theme?: HyperframeTheme;
}

interface DrawResult {
  resolvedRefs: RenderedScene["resolvedRefs"];
  warning?: string;
}

export interface HyperframeTreeRenderOpts {
  aspectRatio: AspectRatio;
  activeCue?: CaptionCue;
  theme?: HyperframeTheme;
  watermark?: string | false;
}

function paletteFor(tone: string | undefined, theme?: HyperframeTheme): Palette {
  if (theme) {
    const colors = theme.colors;
    return {
      fg: colors.fg,
      subtle: colors.subtle,
      accent: colors.accent,
      success: colors.success,
      warning: colors.warning,
      panel: rgba(colors.surface, tone === "paper" ? 0.82 : 0.34),
      border: rgba(colors.border, 0.72),
    };
  }
  if (tone === "paper") {
    return {
      fg: "#191b29",
      subtle: "#5d6275",
      accent: THEME.accent,
      success: "#2ea043",
      warning: "#b7791f",
      panel: "rgba(255, 255, 255, 0.64)",
      border: "rgba(25, 27, 41, 0.14)",
    };
  }
  return {
    fg: THEME.fg,
    subtle: THEME.subtle,
    accent: THEME.accent,
    success: "#7ee787",
    warning: "#ffb86c",
    panel: "rgba(8, 12, 22, 0.36)",
    border: "rgba(255, 255, 255, 0.12)",
  };
}

function rgba(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function typography(env: RenderEnv): { display: string; body: string; mono: string } {
  return env.theme?.typography ?? { display: THEME.sansBold, body: THEME.sans, mono: THEME.mono };
}

function fontFor(env: RenderEnv, role: "display" | "body" | "mono", size: number): string {
  return `${size}px '${typography(env)[role]}'`;
}

function textSize(env: RenderEnv, variant: unknown): number {
  const base = Math.min(env.dims.width, env.dims.height);
  if (variant === "title") return Math.round(base * 0.052);
  if (variant === "eyebrow" || variant === "caption") return Math.round(base * 0.022);
  if (variant === "section") return Math.round(base * 0.034);
  return Math.round(base * 0.028);
}

function panelRadius(box: Box, scale = 0.035): number {
  return Math.min(18, Math.round(Math.min(box.w, box.h) * scale));
}

function gapPx(gap: unknown, base: number): number {
  if (gap === "xs") return Math.round(base * 0.012);
  if (gap === "sm") return Math.round(base * 0.02);
  if (gap === "lg") return Math.round(base * 0.045);
  if (gap === "xl") return Math.round(base * 0.065);
  return Math.round(base * 0.032);
}

function paddingPx(padding: unknown, base: number): number {
  if (padding === "xs") return Math.round(base * 0.025);
  if (padding === "sm") return Math.round(base * 0.04);
  if (padding === "md") return Math.round(base * 0.055);
  if (padding === "xl") return Math.round(base * 0.085);
  return Math.round(base * 0.07);
}

function isElement(value: HyperframeChild): value is HyperframeElement {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "type" in value && "props" in value);
}

function flattenChildren(children: HyperframeChild[]): HyperframeChild[] {
  const out: HyperframeChild[] = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flattenChildren(child));
    else if (child !== null && child !== undefined && child !== false) out.push(child);
  }
  return out;
}

function elementChildren(element: HyperframeElement): HyperframeChild[] {
  return flattenChildren(element.children);
}

function elementChildElements(element: HyperframeElement): HyperframeElement[] {
  return elementChildren(element).filter(isElement);
}

function propsOf(element: HyperframeElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

function textContent(children: HyperframeChild[]): string {
  return flattenChildren(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isElement(child)) return textContent(elementChildren(child));
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawStageBackground(ctx: SKRSContext2D, dims: Dims, tone: string | undefined, theme?: HyperframeTheme): void {
  if (theme) {
    ctx.fillStyle = theme.colors.bg;
    ctx.fillRect(0, 0, dims.width, dims.height);
    const g = ctx.createLinearGradient(0, 0, dims.width, dims.height);
    g.addColorStop(0, rgba(theme.colors.surface, 0));
    g.addColorStop(1, rgba(theme.colors.surface, 0.22));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, dims.width, dims.height);
    return;
  }
  if (tone !== "paper") {
    drawBackground(ctx, dims);
    return;
  }
  const g = ctx.createLinearGradient(0, 0, dims.width, dims.height);
  g.addColorStop(0, "#f7f4ec");
  g.addColorStop(1, "#dfe8f4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, dims.width, dims.height);
}

function estimateHeight(ctx: SKRSContext2D, child: HyperframeElement, box: Box, env: RenderEnv): number | undefined {
  const base = Math.min(env.dims.width, env.dims.height);
  const props = propsOf(child);
  if (props.grow) return undefined;
  if (child.type === "Text") {
    const variant = props.variant;
    const size = textSize(env, variant);
    ctx.font = fontFor(env, variant === "body" ? "body" : "display", size);
    const lines = wrapText(ctx, textContent(elementChildren(child)), box.w).slice(0, variant === "title" ? 2 : 4);
    return Math.max(size * 1.3, lines.length * size * 1.22);
  }
  if (child.type === "LowerThird") return Math.round(base * 0.2);
  if (child.type === "Callout") return Math.round(base * 0.11);
  if (child.type === "Badge") return Math.max(34, Math.round(base * 0.036));
  if (child.type === "Divider") return Math.max(34, Math.round(base * 0.07));
  if (child.type === "Meter") return Math.max(76, Math.round(base * 0.085));
  if (child.type === "TimelineRail") return Math.round(base * 0.13);
  if (child.type === "Panel") {
    const pad = paddingPx(props.padding ?? "sm", Math.min(box.w, box.h));
    let height = pad * 2;
    let compactRow = false;
    if (typeof props.title === "string") height += base * 0.04;
    if (typeof props.subtitle === "string") height += base * 0.034;
    const children = elementChildElements(child);
    if (children.length > 0) {
      const childBox = { ...box, w: Math.max(1, box.w - pad * 2), h: Math.max(1, box.h - pad * 2) };
      const childHeights = children.map((panelChild) => estimateHeight(ctx, panelChild, childBox, env));
      if (
        children[0]?.type === "Badge" &&
        children.slice(1).every((panelChild) => panelChild.type === "Text") &&
        childHeights.every((h): h is number => typeof h === "number")
      ) {
        compactRow = true;
        const textHeights = childHeights.slice(1);
        const textHeight =
          textHeights.reduce((sum, h) => sum + h, 0) + gapPx("xs", base) * Math.max(0, textHeights.length - 1);
        height += Math.max(childHeights[0]!, textHeight);
      } else if (childHeights.every((h): h is number => typeof h === "number")) {
        height += childHeights.reduce((sum, h) => sum + h, 0) + gapPx("xs", base) * (children.length - 1);
      } else {
        height += base * 0.28;
      }
    }
    return Math.min(box.h, Math.max(base * (compactRow ? 0.1 : 0.16), height));
  }
  if (child.type === "KineticCaption") return 0;
  if (child.type === "CaptionSafeArea") return undefined;
  return undefined;
}

function mergeResult(target: DrawResult, source: DrawResult): void {
  target.resolvedRefs.push(...source.resolvedRefs);
  target.warning = target.warning ?? source.warning;
}

function emptyResult(): DrawResult {
  return { resolvedRefs: [] };
}

function drawPanel(ctx: SKRSContext2D, box: Box, env: RenderEnv): void {
  const r = panelRadius(box);
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.fillStyle = env.palette.panel;
  ctx.fill();
  ctx.strokeStyle = env.palette.border;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTextNode(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const variant = props.variant;
  const size = textSize(env, variant);
  ctx.font = fontFor(env, variant === "body" ? "body" : "display", size);
  ctx.fillStyle = variant === "eyebrow" ? env.palette.accent : variant === "body" ? env.palette.subtle : env.palette.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, textContent(elementChildren(element)), box.w).slice(0, variant === "title" ? 2 : 4);
  let y = box.y;
  for (const line of lines) {
    ctx.fillText(line, box.x, y);
    y += size * 1.22;
  }
}

function drawLowerThird(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const eyebrow = typeof props.eyebrow === "string" ? props.eyebrow : undefined;
  const title = typeof props.title === "string" ? props.title : "";
  const subtitle = typeof props.subtitle === "string" ? props.subtitle : undefined;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let y = box.y;
  if (eyebrow) {
    ctx.font = fontFor(env, "display", Math.round(base * 0.022));
    ctx.fillStyle = env.palette.accent;
    ctx.fillText(eyebrow, box.x, y);
    y += base * 0.038;
  }
  ctx.font = fontFor(env, "display", Math.round(base * 0.052));
  ctx.fillStyle = env.palette.fg;
  for (const line of wrapText(ctx, title, box.w).slice(0, 2)) {
    ctx.fillText(line, box.x, y);
    y += base * 0.062;
  }
  if (subtitle) {
    ctx.font = fontFor(env, "body", Math.round(base * 0.026));
    ctx.fillStyle = env.palette.subtle;
    for (const line of wrapText(ctx, subtitle, box.w).slice(0, 2)) {
      ctx.fillText(line, box.x, y);
      y += base * 0.035;
    }
  }
}

function drawCallout(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const text = typeof props.text === "string" ? props.text : "";
  const base = Math.min(env.dims.width, env.dims.height);
  const radius = Math.min(18, Math.round(base * 0.018));
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fillStyle = props.tone === "success" ? rgba(env.palette.success, 0.18) : rgba(env.palette.accent, 0.18);
  ctx.fill();
  ctx.strokeStyle = props.tone === "success" ? rgba(env.palette.success, 0.52) : rgba(env.palette.accent, 0.52);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = fontFor(env, "display", Math.round(base * 0.024));
  ctx.fillStyle = env.palette.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(wrapText(ctx, text, box.w - base * 0.045)[0] ?? text, box.x + base * 0.022, box.y + box.h / 2);
}

function toneColor(tone: unknown, env: RenderEnv): { fill: string; stroke: string; fg: string } {
  if (tone === "success")
    return { fill: rgba(env.palette.success, 0.18), stroke: rgba(env.palette.success, 0.55), fg: env.palette.success };
  if (tone === "warning")
    return { fill: rgba(env.palette.warning, 0.18), stroke: rgba(env.palette.warning, 0.52), fg: env.palette.warning };
  if (tone === "accent" || tone === "info")
    return { fill: rgba(env.palette.accent, 0.18), stroke: rgba(env.palette.accent, 0.55), fg: env.palette.accent };
  return { fill: env.palette.panel, stroke: env.palette.border, fg: env.palette.subtle };
}

async function renderPanel(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  const result = emptyResult();
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const colors = toneColor(props.tone, env);
  roundRect(ctx, box.x, box.y, box.w, box.h, panelRadius(box));
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = props.tone && props.tone !== "default" ? 3 : 2;
  ctx.stroke();

  const pad = paddingPx(props.padding ?? "sm", Math.min(box.w, box.h));
  let y = box.y + pad;
  const title = typeof props.title === "string" ? props.title : undefined;
  const subtitle = typeof props.subtitle === "string" ? props.subtitle : undefined;
  if (title) {
    ctx.font = fontFor(env, "display", Math.round(base * 0.028));
    ctx.fillStyle = env.palette.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(wrapText(ctx, title, box.w - pad * 2)[0] ?? title, box.x + pad, y);
    y += base * 0.04;
  }
  if (subtitle) {
    ctx.font = fontFor(env, "body", Math.round(base * 0.021));
    ctx.fillStyle = env.palette.subtle;
    ctx.fillText(wrapText(ctx, subtitle, box.w - pad * 2)[0] ?? subtitle, box.x + pad, y);
    y += base * 0.034;
  }
  const children = elementChildElements(element);
  if (children.length === 0) return result;
  const contentBox = { x: box.x + pad, y, w: Math.max(1, box.w - pad * 2), h: Math.max(1, box.y + box.h - pad - y) };
  if (children[0]?.type === "Badge" && children.slice(1).every((child) => child.type === "Text")) {
    const badgeProps = propsOf(children[0]);
    const badgeText = typeof badgeProps.text === "string" ? badgeProps.text : textContent(elementChildren(children[0]));
    const badgeFontSize = Math.round(base * 0.02);
    ctx.font = fontFor(env, "display", badgeFontSize);
    const badgeW = Math.min(
      contentBox.w * 0.32,
      Math.max(Math.round(base * 0.065), ctx.measureText(badgeText).width + badgeFontSize * 2.1),
    );
    const badgeH = Math.min(Math.round(base * 0.052), contentBox.h);
    mergeResult(
      result,
      await renderNode(ctx, children[0], { x: contentBox.x, y: contentBox.y, w: badgeW, h: badgeH }, env),
    );
    mergeResult(
      result,
      await renderStack(
        ctx,
        {
          ...element,
          type: "Stack",
          props: { direction: "vertical", gap: "xs", grow: true },
          children: children.slice(1),
        },
        {
          x: contentBox.x + badgeW + Math.round(base * 0.018),
          y: contentBox.y,
          w: Math.max(1, contentBox.w - badgeW - Math.round(base * 0.018)),
          h: contentBox.h,
        },
        env,
      ),
    );
    return result;
  }
  ctx.save();
  roundRect(
    ctx,
    box.x + pad / 2,
    box.y + pad / 2,
    Math.max(1, box.w - pad),
    Math.max(1, box.h - pad),
    panelRadius(box, 0.03),
  );
  ctx.clip();
  mergeResult(
    result,
    await renderStack(
      ctx,
      { ...element, type: "Stack", props: { direction: "vertical", gap: "xs", grow: true }, children },
      contentBox,
      env,
    ),
  );
  ctx.restore();
  return result;
}

function drawBadge(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const text = typeof props.text === "string" ? props.text : textContent(elementChildren(element));
  const base = Math.min(env.dims.width, env.dims.height);
  const colors = toneColor(props.tone, env);
  const fontSize = Math.round(base * 0.02);
  ctx.font = fontFor(env, "display", fontSize);
  const w = Math.min(box.w, ctx.measureText(text).width + fontSize * 1.8);
  const h = Math.min(box.h, fontSize * 1.75);
  roundRect(ctx, box.x, box.y + (box.h - h) / 2, w, h, h / 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + w / 2, box.y + box.h / 2);
}

function drawDivider(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const label = typeof props.label === "string" ? props.label : undefined;
  const y = box.y + box.h / 2;
  ctx.strokeStyle = env.palette.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.x, y);
  ctx.lineTo(box.x + box.w, y);
  ctx.stroke();
  if (label) {
    const base = Math.min(env.dims.width, env.dims.height);
    ctx.font = fontFor(env, "display", Math.round(base * 0.018));
    ctx.fillStyle = env.palette.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, box.x + box.w / 2, y - base * 0.012);
  }
}

function drawMeter(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const label = typeof props.label === "string" ? props.label : undefined;
  const rawProgress =
    typeof props.progress === "number"
      ? props.progress
      : typeof props.value === "number" && typeof props.max === "number" && props.max > 0
        ? props.value / props.max
        : 0;
  const progress = Math.max(0, Math.min(1, rawProgress));
  const colors = toneColor(props.tone, env);
  const barH = Math.max(10, Math.round(base * 0.022));
  let y = box.y;
  if (label) {
    ctx.font = fontFor(env, "display", Math.round(base * 0.022));
    ctx.fillStyle = env.palette.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(wrapText(ctx, label, box.w)[0] ?? label, box.x, y);
    y += base * 0.036;
  }
  roundRect(ctx, box.x, y, box.w, barH, barH / 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fill();
  const fillW = box.w * progress;
  if (fillW > 0) {
    roundRect(ctx, box.x, y, Math.max(barH, fillW), barH, barH / 2);
    ctx.fillStyle = colors.stroke;
    ctx.fill();
  }
}

function drawSystemMap(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const steps = Array.isArray(props.steps)
    ? props.steps.filter((step): step is string => typeof step === "string")
    : [];
  const labels = steps.length ? (steps as string[]) : ["Gather", "Author", "Compile", "Render", "Verify"];
  const activeIndex = typeof props.activeIndex === "number" ? props.activeIndex : 0;
  const base = Math.min(box.w, box.h);
  const pad = Math.round(base * 0.1);
  drawPanel(ctx, box, env);
  const requested = props.orientation;
  const horizontal = requested === "horizontal" ? true : requested === "vertical" ? false : box.w > box.h * 1.2;
  const nodeCount = labels.length;
  const gap = Math.round(base * 0.045);
  const nodeW = horizontal ? (box.w - pad * 2 - gap * (nodeCount - 1)) / nodeCount : box.w - pad * 2;
  const nodeH = horizontal ? box.h * 0.36 : (box.h - pad * 2 - gap * (nodeCount - 1)) / nodeCount;
  ctx.font = fontFor(env, "display", Math.round(base * 0.065));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < nodeCount; i++) {
    const x = horizontal ? box.x + pad + i * (nodeW + gap) : box.x + pad;
    const y = horizontal ? box.y + box.h / 2 - nodeH / 2 : box.y + pad + i * (nodeH + gap);
    const active = i === activeIndex;
    roundRect(ctx, x, y, nodeW, nodeH, Math.min(18, Math.round(base * 0.035)));
    ctx.fillStyle = active ? rgba(env.palette.accent, 0.35) : rgba(env.palette.fg, 0.08);
    ctx.fill();
    ctx.strokeStyle = active ? env.palette.accent : env.palette.border;
    ctx.lineWidth = active ? 4 : 2;
    ctx.stroke();
    ctx.fillStyle = env.palette.fg;
    for (const [lineIndex, line] of wrapText(ctx, labels[i]!, nodeW * 0.84)
      .slice(0, 2)
      .entries()) {
      ctx.fillText(line, x + nodeW / 2, y + nodeH / 2 + (lineIndex - 0.5) * base * 0.12);
    }
  }
}

function drawTimelineRail(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const steps = Array.isArray(props.steps)
    ? props.steps.filter((step): step is string => typeof step === "string")
    : [];
  const labels = steps as string[];
  if (labels.length === 0) return;
  const activeIndex = typeof props.activeIndex === "number" ? props.activeIndex : 0;
  const progress =
    typeof props.progress === "number"
      ? Math.max(0, Math.min(1, props.progress))
      : labels.length <= 1
        ? 1
        : Math.max(0, Math.min(1, activeIndex / (labels.length - 1)));
  const base = Math.min(env.dims.width, env.dims.height);
  drawPanel(ctx, box, env);
  const y = box.y + box.h / 2;
  const start = box.x + base * 0.04;
  const end = box.x + box.w - base * 0.04;
  ctx.strokeStyle = env.palette.border;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(start, y);
  ctx.lineTo(end, y);
  ctx.stroke();
  ctx.strokeStyle = env.palette.accent;
  ctx.beginPath();
  ctx.moveTo(start, y);
  ctx.lineTo(start + (end - start) * progress, y);
  ctx.stroke();
  labels.forEach((label, i) => {
    const x = start + ((end - start) * i) / Math.max(1, labels.length - 1);
    ctx.beginPath();
    ctx.arc(x, y, i === activeIndex ? base * 0.012 : base * 0.008, 0, Math.PI * 2);
    ctx.fillStyle = i <= activeIndex ? env.palette.accent : env.palette.subtle;
    ctx.fill();
    ctx.font = fontFor(env, "display", Math.round(base * 0.018));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = env.palette.subtle;
    ctx.fillText(label, x, y + base * 0.02);
  });
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

  const fixed = children.map((child) => estimateHeight(ctx, child, box, env));
  const fixedTotal = fixed.reduce<number>((sum, height) => sum + (height ?? 0), 0);
  const flexCount = Math.max(1, fixed.filter((height) => height === undefined).length);
  const flexH = Math.max(1, (box.h - fixedTotal - gap * (children.length - 1)) / flexCount);
  let y = box.y;
  for (let i = 0; i < children.length; i++) {
    const h = fixed[i] ?? flexH;
    mergeResult(result, await renderNode(ctx, children[i]!, { x: box.x, y, w: box.w, h }, env));
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
      let y = box.y + (box.h - naturalTotal) / 2;
      for (let row = 0; row < rows; row++) {
        const rowH = naturalRows[row]!;
        for (let col = 0; col < columns; col++) {
          const index = row * columns + col;
          if (index >= children.length) break;
          mergeResult(
            result,
            await renderNode(ctx, children[index]!, { x: box.x + col * (cellW + gap), y, w: cellW, h: rowH }, env),
          );
        }
        y += rowH + gap;
      }
      return result;
    }
  }
  for (let i = 0; i < children.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    mergeResult(
      result,
      await renderNode(
        ctx,
        children[i]!,
        { x: box.x + col * (cellW + gap), y: box.y + row * (fillCellH + gap), w: cellW, h: fillCellH },
        env,
      ),
    );
  }
  return result;
}

async function renderNode(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): Promise<DrawResult> {
  if (box.w <= 1 || box.h <= 1) return emptyResult();
  if (element.type === "CaptionSafeArea") {
    const safe = Math.round(Math.min(env.dims.width, env.dims.height) * 0.15);
    return renderStack(
      ctx,
      { ...element, type: "Stack", props: { direction: "vertical", gap: "md", grow: true } },
      { ...box, h: Math.max(1, box.h - safe) },
      env,
    );
  }
  if (element.type === "Stack") return renderStack(ctx, element, box, env);
  if (element.type === "Grid") return renderGrid(ctx, element, box, env);
  if (element.type === "Text") {
    drawTextNode(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "LowerThird") {
    drawLowerThird(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "Callout") {
    if (propsOf(element).when === false) return emptyResult();
    drawCallout(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "Panel") return renderPanel(ctx, element, box, env);
  if (element.type === "Badge") {
    drawBadge(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "Divider") {
    drawDivider(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "Meter") {
    drawMeter(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "CodeRef") return renderCodeRef(ctx, element, box, env);
  if (element.type === "DiffRef") return renderDiffRef(ctx, element, box, env);
  if (element.type === "Chart") return renderChart(ctx, element, box, env);
  if (element.type === "ImageAsset") {
    await renderImageAsset(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "SystemMap") {
    drawSystemMap(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "TimelineRail") {
    drawTimelineRail(ctx, element, box, env);
    return emptyResult();
  }
  if (element.type === "Stage") return renderStage(ctx, element, env);
  throw new Error(
    `Unknown hyperframe element "${element.type}". Import a supported component from @agent-video/hyperframes.`,
  );
}

function collectKineticCaptions(element: HyperframeElement): HyperframeElement[] {
  const found: HyperframeElement[] = [];
  if (element.type === "KineticCaption") found.push(element);
  for (const child of elementChildElements(element)) found.push(...collectKineticCaptions(child));
  return found;
}

function drawKineticCaption(ctx: SKRSContext2D, element: HyperframeElement, env: RenderEnv): void {
  if (!env.activeCue?.text) return;
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const maxWords = typeof props.maxWords === "number" ? props.maxWords : props.mode === "word-pop" ? 7 : 12;
  const words = env.activeCue.text.split(/\s+/).slice(0, maxWords);
  const text = words.join(" ");
  const fontSize = Math.round(base * (props.mode === "minimal" ? 0.032 : 0.046));
  ctx.font = fontFor(env, "display", fontSize);
  const maxW = env.dims.width * 0.76;
  const lines = wrapText(ctx, text, maxW).slice(0, 2);
  const lineH = fontSize * 1.18;
  const padX = base * 0.035;
  const padY = base * 0.02;
  const boxW = Math.min(
    env.dims.width - base * 0.08,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2,
  );
  const boxH = lines.length * lineH + padY * 2;
  const x = (env.dims.width - boxW) / 2;
  const position = props.position;
  const y =
    position === "top"
      ? base * 0.08
      : position === "middle"
        ? (env.dims.height - boxH) / 2
        : env.dims.height - boxH - base * 0.075;
  roundRect(ctx, x, y, boxW, boxH, Math.round(base * 0.022));
  ctx.fillStyle = env.theme ? rgba(env.theme.colors.captionBg, 0.88) : "rgba(7, 10, 18, 0.72)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let ty = y + padY + lineH / 2;
  for (const line of lines) {
    ctx.fillStyle = env.theme ? env.theme.colors.captionFg : env.palette.fg;
    ctx.fillText(line, env.dims.width / 2, ty);
    ty += lineH;
  }
}

async function renderStage(ctx: SKRSContext2D, element: HyperframeElement, env: RenderEnv): Promise<DrawResult> {
  const props = propsOf(element);
  const tone = typeof props.tone === "string" ? props.tone : "dark";
  env.palette = paletteFor(tone, env.theme);
  drawStageBackground(ctx, env.dims, tone, env.theme);
  const base = Math.min(env.dims.width, env.dims.height);
  const pad = paddingPx(props.padding, base);
  const content: HyperframeElement = {
    type: "Stack",
    props: { direction: "vertical", gap: "md", grow: true },
    children: elementChildren(element).filter((child) => !(isElement(child) && child.type === "KineticCaption")),
  };
  const result = await renderStack(
    ctx,
    content,
    { x: pad, y: pad, w: env.dims.width - pad * 2, h: env.dims.height - pad * 2 },
    env,
  );
  for (const caption of collectKineticCaptions(element)) drawKineticCaption(ctx, caption, env);
  return result;
}

export async function renderHyperframeElementToPng(
  element: HyperframeElement,
  opts: HyperframeTreeRenderOpts,
): Promise<RenderedScene> {
  ensureFonts();
  const dims = dimsFor(opts.aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  const env: RenderEnv = {
    dims,
    palette: paletteFor("dark", opts.theme),
    activeCue: opts.activeCue,
    theme: opts.theme,
  };
  const result =
    element.type === "Stage"
      ? await renderStage(ctx, element, env)
      : await renderNode(ctx, element, { x: 0, y: 0, w: dims.width, h: dims.height }, env);

  if (opts.watermark !== false) drawWatermark(ctx, dims, opts.watermark ?? "agent-video.dev", canvasTheme(opts.theme));

  return {
    png: canvas.toBuffer("image/png"),
    width: dims.width,
    height: dims.height,
    resolvedRefs: result.resolvedRefs,
    warning: result.warning,
  };
}
