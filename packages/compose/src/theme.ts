/** The single default theme. Pinned for determinism (same spec → same pixels). */
export const THEME = {
  bg: ["#0f0f23", "#1a1a3e"] as [string, string],
  fg: "#e8e8f2",
  subtle: "#9aa0b4",
  codeBg: "#11111b",
  codeBar: "#181826",
  cardBorder: "rgba(255,255,255,0.08)",
  focus: "rgba(124,140,255,0.16)",
  accent: "#7c8cff",
  gutter: "#5b6072",
  sans: "Inter",
  sansBold: "Inter Bold",
  mono: "JetBrains Mono",
  shikiTheme: "github-dark",
  watermarkFg: "rgba(255,255,255,0.5)",
} as const;
