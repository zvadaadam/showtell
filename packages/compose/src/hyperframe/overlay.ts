/** Stage background and the kinetic-caption overlay. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { HyperframeElement } from "@agent-video/hyperframes";
import type { Dims } from "../dims.ts";
import { roundRect, wrapText } from "../draw.ts";
import { propsOf } from "../render-hyperframe-shared.ts";
import { elementChildElements } from "./element.ts";
import { clamp01, drift, easeOutBack, easeOutCubic } from "./motion.ts";
import { fontFor } from "./typography.ts";
import { rgba, TOKENS, type RenderEnv } from "./tokens.ts";

/**
 * Background = base color + a duotone accent wash (accent2 key glow top-right,
 * accent fill glow bottom-left) + an edge vignette. All hues come from the
 * theme, so preset switches restyle the whole frame. With a motion clock the
 * glow centers drift on a slow sine so the frame never feels frozen.
 */
export function drawStageBackground(ctx: SKRSContext2D, dims: Dims, env: RenderEnv): void {
  const { width, height } = dims;
  const long = Math.max(width, height);
  const palette = env.palette;
  const bgTokens = TOKENS.background;

  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, width, height);

  const keyX = width * (0.85 + drift(env, TOKENS.motion.driftMs, 0) * 0.035);
  const keyY = height * (-0.25 + drift(env, TOKENS.motion.driftMs, 0.3) * 0.05);
  const key = ctx.createRadialGradient(keyX, keyY, 0, keyX, keyY, long * 0.9);
  key.addColorStop(0, rgba(palette.accent2, palette.isLight ? bgTokens.keyGlowLight : bgTokens.keyGlowDark));
  key.addColorStop(1, rgba(palette.accent2, 0));
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, width, height);

  const fillX = width * (0.02 + drift(env, TOKENS.motion.driftMs * 1.35, 0.62) * 0.03);
  const fillY = height * (1.1 + drift(env, TOKENS.motion.driftMs * 1.35, 0.85) * 0.04);
  const fill = ctx.createRadialGradient(fillX, fillY, 0, fillX, fillY, long * 0.75);
  fill.addColorStop(0, rgba(palette.accent, palette.isLight ? bgTokens.fillGlowLight : bgTokens.fillGlowDark));
  fill.addColorStop(1, rgba(palette.accent, 0));
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);

  const vignette = ctx.createRadialGradient(width / 2, height / 2, long * 0.25, width / 2, height / 2, long * 0.78);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, `rgba(0, 0, 0, ${palette.isLight ? bgTokens.vignetteLight : bgTokens.vignetteDark})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

export function collectKineticCaptions(element: HyperframeElement): HyperframeElement[] {
  const found: HyperframeElement[] = [];
  if (element.type === "KineticCaption") found.push(element);
  for (const child of elementChildElements(element)) found.push(...collectKineticCaptions(child));
  return found;
}

function normalizeEmphasisWord(word: string): string {
  return word.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function emphasisSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map(normalizeEmphasisWord)
      .filter(Boolean),
  );
}

interface CaptionWordState {
  text: string;
  /** 0..1 pop progress (alpha + scale); 1 for settled words. */
  pop: number;
  /** True when this is the karaoke-active word. */
  active: boolean;
  emphasized: boolean;
}

/** ms since the active cue started, or Infinity when rendering a still. */
function cueElapsedMs(env: RenderEnv): number {
  if (!env.motion || !env.activeCue) return Number.POSITIVE_INFINITY;
  return Math.max(0, env.motion.absoluteMs - env.activeCue.startMs);
}

function captionWordStates(
  env: RenderEnv,
  words: string[],
  mode: unknown,
  emphasized: Set<string>,
): CaptionWordState[] {
  const elapsed = cueElapsedMs(env);
  const cue = env.activeCue;
  const cueDuration = cue ? Math.max(1, cue.endMs - cue.startMs) : 1;
  const perWord = Math.min(TOKENS.motion.captionWordMs, (cueDuration * 0.55) / Math.max(1, words.length));
  const activeIndex = Math.min(words.length - 1, Math.floor((elapsed / cueDuration) * words.length));
  return words.map((text, index) => {
    const pop = mode === "word-pop" ? clamp01((elapsed - index * perWord) / 180) : 1;
    return {
      text,
      pop,
      active: mode === "karaoke" && index === activeIndex,
      emphasized: emphasized.has(normalizeEmphasisWord(text)),
    };
  });
}

function drawCaptionWords(
  ctx: SKRSContext2D,
  states: CaptionWordState[],
  centerX: number,
  y: number,
  fontSize: number,
  defaultFill: string,
  accentFill: string,
): void {
  const spaceW = ctx.measureText(" ").width;
  const widths = states.map((state) => ctx.measureText(state.text).width);
  const totalW = widths.reduce((sum, w) => sum + w, 0) + spaceW * Math.max(0, states.length - 1);
  let x = centerX - totalW / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < states.length; i++) {
    const state = states[i]!;
    if (state.pop > 0) {
      const pop = easeOutBack(state.pop);
      ctx.save();
      ctx.globalAlpha *= clamp01(state.pop * 1.4);
      ctx.translate(x + widths[i]! / 2, y);
      ctx.scale(0.82 + 0.18 * pop, 0.82 + 0.18 * pop);
      ctx.fillStyle = state.active || state.emphasized ? accentFill : defaultFill;
      ctx.fillText(state.text, -widths[i]! / 2, (1 - state.pop) * fontSize * 0.18);
      ctx.restore();
    }
    x += widths[i]! + spaceW;
  }
  ctx.textAlign = "center";
}

export function drawKineticCaption(ctx: SKRSContext2D, element: HyperframeElement, env: RenderEnv): void {
  if (!env.activeCue?.text) return;
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const maxWords = typeof props.maxWords === "number" ? props.maxWords : props.mode === "word-pop" ? 7 : 12;
  const words = env.activeCue.text.split(/\s+/).slice(0, maxWords);
  const text = words.join(" ");
  const fontSize = Math.round(base * (props.mode === "minimal" ? 0.032 : 0.044));
  ctx.font = fontFor(env, "display", fontSize);
  const maxW = env.dims.width * 0.76;
  const lines = wrapText(ctx, text, maxW).slice(0, 2);
  const lineH = fontSize * 1.22;
  const padX = base * 0.038;
  const padY = base * 0.022;
  const boxW = Math.min(
    env.dims.width - base * 0.08,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2,
  );
  const boxH = lines.length * lineH + padY * 2;
  const x = (env.dims.width - boxW) / 2;
  const position = props.position;
  const baseY =
    position === "top"
      ? base * 0.08
      : position === "middle"
        ? (env.dims.height - boxH) / 2
        : env.dims.height - boxH - base * 0.075;

  // The pill rises in over the first ~260ms of each cue.
  const rise = easeOutCubic(env.motion ? clamp01(cueElapsedMs(env) / 260) : 1);
  const y = baseY + (1 - rise) * base * 0.018;

  ctx.save();
  ctx.globalAlpha = rise;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = Math.round(base * 0.03);
  ctx.shadowOffsetY = Math.round(base * 0.008);
  roundRect(ctx, x, y, boxW, boxH, Math.min(26, boxH / 2));
  ctx.fillStyle = env.theme ? rgba(env.theme.colors.captionBg, 0.86) : "rgba(5, 6, 11, 0.84)";
  ctx.fill();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const defaultFill = env.theme ? env.theme.colors.captionFg : env.palette.fg;
  const emphasized = emphasisSet(props.emphasis);
  const animatedWords = props.mode === "word-pop" || props.mode === "karaoke";
  let ty = y + padY + lineH / 2;
  let wordCursor = 0;
  for (const line of lines) {
    const lineWords = line.split(/\s+/).filter(Boolean);
    if (animatedWords) {
      const states = captionWordStates(env, words, props.mode, emphasized).slice(
        wordCursor,
        wordCursor + lineWords.length,
      );
      drawCaptionWords(ctx, states, env.dims.width / 2, ty, fontSize, defaultFill, env.palette.accent);
      wordCursor += lineWords.length;
    } else if (emphasized.size > 0) {
      const states: CaptionWordState[] = lineWords.map((word) => ({
        text: word,
        pop: 1,
        active: false,
        emphasized: emphasized.has(normalizeEmphasisWord(word)),
      }));
      drawCaptionWords(ctx, states, env.dims.width / 2, ty, fontSize, defaultFill, env.palette.accent);
    } else {
      ctx.fillStyle = defaultFill;
      ctx.fillText(line, env.dims.width / 2, ty);
    }
    ty += lineH;
  }
  ctx.restore();
}
