export interface SemanticTheme {
  mode: "dark" | "paper" | "neutral";
  colors: {
    fg: string;
    bg: string;
    subtle: string;
    accent: string;
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
}

/** The single default theme. Pinned for determinism (same spec → same pixels). */
export const THEME: CanvasTheme = {
  bg: ["#0f0f23", "#1a1a3e"] as [string, string],
  fg: "#e8e8f2",
  subtle: "#9aa0b4",
  codeBg: "#11111b",
  codeBar: "#181826",
  cardBorder: "rgba(255,255,255,0.08)",
  focus: "rgba(124,140,255,0.16)",
  accent: "#7c8cff",
  success: "#7ee787",
  warning: "#ffb86c",
  gutter: "#5b6072",
  sans: "Inter",
  sansBold: "Inter Bold",
  mono: "JetBrains Mono",
  shikiTheme: "github-dark",
  watermarkFg: "rgba(255,255,255,0.5)",
  captionBg: "rgba(7,10,18,0.78)",
  captionFg: "#e8e8f2",
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
  };
}
