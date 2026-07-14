import type { ResolvedBundleTheme } from "@showtell/core";

export interface CanvasTheme {
  cardBorder: string;
  sans: string;
  sansBold: string;
  watermarkFg: string;
  captionBg: string;
  captionFg: string;
}

/** The single default theme (matches the "ink" preset). Pinned for determinism (same spec → same pixels). */
export const THEME: CanvasTheme = {
  cardBorder: "rgba(255,255,255,0.08)",
  sans: "Inter",
  sansBold: "Inter Bold",
  watermarkFg: "rgba(255,255,255,0.5)",
  captionBg: "rgba(5,6,11,0.8)",
  captionFg: "#f2f3f7",
} as const;

function rgba(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function canvasTheme(theme?: ResolvedBundleTheme): CanvasTheme {
  if (!theme) return THEME;
  return {
    cardBorder: rgba(theme.colors.border, 0.72),
    sans: theme.typography.body,
    sansBold: theme.typography.display,
    watermarkFg: rgba(theme.colors.fg, 0.5),
    captionBg: rgba(theme.colors.captionBg ?? theme.colors.bg, 0.88),
    captionFg: theme.colors.captionFg ?? theme.colors.fg,
  };
}
