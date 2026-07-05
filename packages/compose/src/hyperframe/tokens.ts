/**
 * Design tokens for hyperframe rendering.
 *
 * Everything visual that is not a semantic theme color lives here: opacity
 * treatments, geometry ratios, and the spacing scale. The semantic colors
 * (fg/bg/accent/…) always come from the resolved bundle theme; this module
 * only decides HOW those colors are applied. Tune the design language in one
 * place instead of hunting magic numbers through the renderers.
 */
import { resolveBundleTheme } from "@agent-video/core";
import type { CaptionCue, HyperframeTheme } from "@agent-video/hyperframes";
import type { Dims } from "../dims.ts";

export const TOKENS = {
  /** Panel treatment (vertical gradient + hairline border + top highlight). */
  panel: {
    fillTopDark: 0.62,
    fillBottomDark: 0.38,
    fillTopLight: 0.95,
    fillBottomLight: 0.85,
    borderDark: 0.11,
    borderLight: 0.13,
    topHighlight: 0.05,
    radiusMax: 22,
    radiusScale: 0.045,
    accentBarWidth: 0.0045,
  },
  /** Tinted fills/strokes for toned surfaces (badges, callouts, active panels). */
  tone: {
    fillDark: 0.13,
    fillLight: 0.09,
    stroke: 0.5,
    mutedFillDark: 0.07,
    mutedFillLight: 0.05,
  },
  /** Progress tracks and rails. */
  track: { alpha: 0.12, alphaLight: 0.1 },
  /** Stage background: accent-hued key/fill glows plus an edge vignette. */
  background: {
    keyGlowDark: 0.17,
    keyGlowLight: 0.1,
    fillGlowDark: 0.09,
    fillGlowLight: 0.05,
    vignetteDark: 0.3,
    vignetteLight: 0.05,
  },
  /** Fraction of the short frame edge reserved by CaptionSafeArea. */
  captionSafeArea: 0.14,
  /** Spacing scale, as fractions of the short frame edge. */
  gap: { xs: 0.012, sm: 0.02, md: 0.032, lg: 0.045, xl: 0.065 },
  padding: { xs: 0.025, sm: 0.04, md: 0.055, lg: 0.07, xl: 0.085 },
  /** Presenter bubble geometry, as fractions of the short frame edge / avatar size. */
  presenter: {
    diameter: { sm: 0.105, md: 0.135, lg: 0.175 },
    margin: 0.04,
    /** Pulse ring: rest radius factor + how far amplitude pushes it out. */
    ringRest: 1.06,
    ringAmplitude: 0.1,
    ringWidth: 0.045,
    /** Amplitude halo: soft accent glow radius growth beyond the avatar. */
    haloRest: 1.1,
    haloAmplitude: 0.38,
    /** Badge diameter as a fraction of the avatar diameter. */
    badgeScale: 0.38,
    /** Badge center offset from the avatar center, as a fraction of its radius. */
    badgeOffset: 0.74,
    enterMs: 520,
  },
  /** Motion timing (ms) and amplitudes. Stills render every animation at its end state. */
  motion: {
    enterMs: 620,
    staggerMs: 80,
    riseFraction: 0.02,
    statCountMs: 950,
    chartMs: 720,
    chartStaggerMs: 90,
    captionWordMs: 150,
    pulseMs: 2600,
    driftMs: 26000,
    lineFadeMs: 220,
  },
} as const;

export interface Palette {
  fg: string;
  subtle: string;
  accent: string;
  accent2: string;
  success: string;
  warning: string;
  /** Base hex colors the fills derive from. */
  bg: string;
  surface: string;
  /** Solid-ish panel fill + hairline stroke (also consumed by media renderers). */
  panel: string;
  border: string;
  isLight: boolean;
}

export interface RenderEnv {
  dims: Dims;
  palette: Palette;
  activeCue?: CaptionCue;
  theme?: HyperframeTheme;
  /** Present when rendering animated video frames; absent for stills. */
  motion?: import("./motion.ts").MotionClock;
}

/** Theme-less rendering falls back to the real presets (ink / paper) so the
 * defaults can never drift from `bundle-theme.ts`. */
const FALLBACK_DARK = resolveBundleTheme().colors;
const FALLBACK_PAPER = resolveBundleTheme({ preset: "paper", colors: {}, typography: {} }).colors;

export function rgba(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function paletteFor(tone: string | undefined, theme?: HyperframeTheme): Palette {
  const isLight = theme ? theme.mode === "paper" : tone === "paper";
  const colors = theme?.colors ?? (isLight ? FALLBACK_PAPER : FALLBACK_DARK);
  return {
    fg: colors.fg,
    subtle: colors.subtle,
    accent: colors.accent,
    accent2: colors.accent2 ?? colors.accent,
    success: colors.success,
    warning: colors.warning,
    bg: colors.bg,
    surface: colors.surface,
    panel: rgba(colors.surface, isLight ? 0.9 : 0.55),
    border: rgba(colors.fg, isLight ? TOKENS.panel.borderLight : TOKENS.panel.borderDark),
    isLight,
  };
}

export interface ToneColors {
  fill: string;
  stroke: string;
  fg: string;
  base: string;
}

export function toneColor(tone: unknown, env: RenderEnv): ToneColors {
  const tinted = (color: string): ToneColors => ({
    fill: rgba(color, env.palette.isLight ? TOKENS.tone.fillLight : TOKENS.tone.fillDark),
    stroke: rgba(color, TOKENS.tone.stroke),
    fg: color,
    base: color,
  });
  if (tone === "success") return tinted(env.palette.success);
  if (tone === "warning") return tinted(env.palette.warning);
  if (tone === "accent" || tone === "info") return tinted(env.palette.accent);
  return {
    fill: rgba(env.palette.fg, env.palette.isLight ? TOKENS.tone.mutedFillLight : TOKENS.tone.mutedFillDark),
    stroke: env.palette.border,
    fg: env.palette.subtle,
    base: env.palette.subtle,
  };
}

export function gapPx(gap: unknown, base: number): number {
  const scale =
    gap === "xs" || gap === "sm" || gap === "lg" || gap === "xl"
      ? TOKENS.gap[gap as keyof typeof TOKENS.gap]
      : TOKENS.gap.md;
  return Math.round(base * scale);
}

export function paddingPx(padding: unknown, base: number): number {
  const scale =
    padding === "xs" || padding === "sm" || padding === "md" || padding === "xl"
      ? TOKENS.padding[padding as keyof typeof TOKENS.padding]
      : TOKENS.padding.lg;
  return Math.round(base * scale);
}
