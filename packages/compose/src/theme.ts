export interface SemanticTheme {
  mode: "dark" | "paper" | "neutral";
  colors: {
    fg: string;
    bg: string;
    subtle: string;
    accent: string;
    /** Secondary hue for background glows; falls back to accent. */
    accent2?: string;
    success: string;
    warning: string;
    surface: string;
    border: string;
    captionBg?: string;
    captionFg?: string;
  };
  typography: {
    display: string;
    body: string;
    mono: string;
  };
  /** Categorical palette for multi-series charts and pies, in series order. */
  chart?: string[];
}

export interface CanvasTheme {
  bg: [string, string];
  fg: string;
  subtle: string;
  codeBg: string;
  codeBar: string;
  cardBorder: string;
  focus: string;
  accent: string;
  success: string;
  warning: string;
  gutter: string;
  sans: string;
  sansBold: string;
  mono: string;
  shikiTheme: "github-dark" | "github-light";
  watermarkFg: string;
  captionBg: string;
  captionFg: string;
  /** Categorical palette for multi-series charts and pies, in series order. */
  series: string[];
}

/** The single default theme (matches the "ink" preset). Pinned for determinism (same spec → same pixels). */
export const THEME: CanvasTheme = {
  bg: ["#0b0c14", "#181228"] as [string, string],
  fg: "#f2f3f7",
  subtle: "#a0a6b8",
  codeBg: "#10111a",
  codeBar: "#171923",
  cardBorder: "rgba(255,255,255,0.08)",
  focus: "rgba(167,139,250,0.15)",
  accent: "#a78bfa",
  success: "#4ade80",
  warning: "#fbbf24",
  gutter: "#5d6274",
  sans: "Inter",
  sansBold: "Inter Bold",
  mono: "JetBrains Mono",
  shikiTheme: "github-dark",
  watermarkFg: "rgba(255,255,255,0.5)",
  captionBg: "rgba(5,6,11,0.8)",
  captionFg: "#f2f3f7",
  series: ["#a78bfa", "#e879f9", "#38bdf8", "#4ade80", "#fbbf24"],
} as const;

function rgba(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function canvasTheme(theme?: SemanticTheme): CanvasTheme {
  if (!theme) return THEME;
  return {
    bg: [theme.colors.bg, theme.colors.bg],
    fg: theme.colors.fg,
    subtle: theme.colors.subtle,
    codeBg: theme.colors.surface,
    codeBar: theme.mode === "paper" ? "#f3f4f6" : rgba(theme.colors.bg, 0.72),
    cardBorder: rgba(theme.colors.border, 0.72),
    focus: rgba(theme.colors.accent, 0.18),
    accent: theme.colors.accent,
    success: theme.colors.success,
    warning: theme.colors.warning,
    gutter: theme.colors.subtle,
    sans: theme.typography.body,
    sansBold: theme.typography.display,
    mono: theme.typography.mono,
    shikiTheme: theme.mode === "paper" ? "github-light" : "github-dark",
    watermarkFg: rgba(theme.colors.fg, 0.5),
    captionBg: rgba(theme.colors.captionBg ?? theme.colors.bg, 0.88),
    captionFg: theme.colors.captionFg ?? theme.colors.fg,
    // Themes without an explicit chart palette get one anchored on their own hues.
    series:
      theme.chart ??
      dedupe([
        theme.colors.accent,
        theme.colors.accent2,
        theme.colors.success,
        theme.colors.warning,
        theme.colors.subtle,
      ]),
  };
}

function dedupe(colors: (string | undefined)[]): string[] {
  return [...new Set(colors.filter((color): color is string => Boolean(color)))];
}
