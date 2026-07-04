/** Bundle v2 theme defaults and validation. */
import { z } from "zod";
import type { BundleError } from "./bundle.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use 6-digit hex colors like #a78bfa.");
const FontFamily = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_. -]+$/, "Use one plain font family name, not CSS, quotes, commas, or a URL.");
const ThemePreset = z.enum(["ink", "aurora", "ember", "orchid", "graphite", "agent-dark", "paper", "neutral"]);
const ThemeMode = z.enum(["dark", "paper", "neutral"]);
const REGISTERED_FONTS = new Set(["Inter", "Inter Medium", "Inter SemiBold", "Inter Bold", "JetBrains Mono"]);

export const Theme = z
  .object({
    preset: ThemePreset.optional(),
    mode: ThemeMode.optional(),
    colors: z
      .object({
        fg: Color.optional(),
        bg: Color.optional(),
        subtle: Color.optional(),
        accent: Color.optional(),
        accent2: Color.optional(),
        success: Color.optional(),
        warning: Color.optional(),
        surface: Color.optional(),
        border: Color.optional(),
        captionBg: Color.optional(),
        captionFg: Color.optional(),
      })
      .strict()
      .default({}),
    typography: z
      .object({
        display: FontFamily.optional(),
        body: FontFamily.optional(),
        mono: FontFamily.optional(),
      })
      .strict()
      .default({}),
    /** Categorical palette for multi-series charts and pies, in series order. */
    chart: z.array(Color).min(2).max(10).optional(),
  })
  .strict();

export type BundleThemePreset = z.infer<typeof ThemePreset>;
export type BundleThemeMode = z.infer<typeof ThemeMode>;
export type BundleTheme = z.infer<typeof Theme>;

export interface ResolvedBundleTheme {
  preset: BundleThemePreset;
  mode: BundleThemeMode;
  colors: {
    fg: string;
    bg: string;
    subtle: string;
    accent: string;
    /** Secondary hue for background glows and gradient washes. */
    accent2: string;
    success: string;
    warning: string;
    surface: string;
    border: string;
    captionBg: string;
    captionFg: string;
  };
  typography: {
    display: string;
    body: string;
    mono: string;
  };
  /** Categorical palette for multi-series charts and pies, in series order. */
  chart: string[];
}

const DEFAULT_TYPOGRAPHY = { display: "Inter Bold", body: "Inter", mono: "JetBrains Mono" } as const;

/** One-line intent per preset, used by `bundle themes` so agents can pick by mood. */
export const THEME_PRESET_GUIDE: Record<BundleThemePreset, string> = {
  ink: "Default. Near-black slate with an iris accent and magenta glow — technical, premium.",
  aurora: "Deep sea green with a teal accent — calm, systems-y, fresh.",
  ember: "Warm charcoal with an amber accent — energetic, launch-video warmth.",
  orchid: "Plum black with a magenta accent — bold, creator-tool energy.",
  graphite: "Pure monochrome with a near-white accent — austere, editorial.",
  "agent-dark": "Legacy navy-and-periwinkle default; kept for existing bundles.",
  paper: "Light warm paper with a cobalt accent — docs-like, daylight-friendly.",
  neutral: "Quiet gray-blue dark with a sky accent — product-walkthrough neutral.",
};

const THEME_PRESETS: Record<BundleThemePreset, ResolvedBundleTheme> = {
  ink: {
    preset: "ink",
    mode: "dark",
    colors: {
      bg: "#0b0c14",
      fg: "#f2f3f7",
      subtle: "#a0a6b8",
      accent: "#a78bfa",
      accent2: "#e879f9",
      success: "#4ade80",
      warning: "#fbbf24",
      surface: "#14161f",
      border: "#363a4d",
      captionBg: "#05060b",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#a78bfa", "#e879f9", "#38bdf8", "#4ade80", "#fbbf24"],
  },
  aurora: {
    preset: "aurora",
    mode: "dark",
    colors: {
      bg: "#071110",
      fg: "#eefaf7",
      subtle: "#93aca7",
      accent: "#2dd4bf",
      accent2: "#38bdf8",
      success: "#86efac",
      warning: "#fbbf24",
      surface: "#102019",
      border: "#2c4a44",
      captionBg: "#030907",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#2dd4bf", "#38bdf8", "#a3e635", "#f472b6", "#fbbf24"],
  },
  ember: {
    preset: "ember",
    mode: "dark",
    colors: {
      bg: "#120e0b",
      fg: "#faf5ef",
      subtle: "#b3a99e",
      accent: "#fbbf24",
      accent2: "#fb7185",
      success: "#4ade80",
      warning: "#fb923c",
      surface: "#201812",
      border: "#4a3b2e",
      captionBg: "#0a0603",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#fbbf24", "#fb7185", "#fb923c", "#a78bfa", "#4ade80"],
  },
  orchid: {
    preset: "orchid",
    mode: "dark",
    colors: {
      bg: "#120a16",
      fg: "#f7f0fa",
      subtle: "#b3a0bd",
      accent: "#e879f9",
      accent2: "#a78bfa",
      success: "#4ade80",
      warning: "#fbbf24",
      surface: "#1f1226",
      border: "#4a3659",
      captionBg: "#08040b",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#e879f9", "#a78bfa", "#f472b6", "#38bdf8", "#4ade80"],
  },
  graphite: {
    preset: "graphite",
    mode: "dark",
    colors: {
      bg: "#0d0e10",
      fg: "#f4f5f7",
      subtle: "#9ba1ab",
      accent: "#e2e8f0",
      accent2: "#94a3b8",
      success: "#4ade80",
      warning: "#fbbf24",
      surface: "#17191d",
      border: "#3a3e46",
      captionBg: "#050607",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#e2e8f0", "#94a3b8", "#64748b", "#cbd5e1", "#f4f5f7"],
  },
  "agent-dark": {
    preset: "agent-dark",
    mode: "dark",
    colors: {
      bg: "#0f0f23",
      fg: "#e8e8f2",
      subtle: "#9aa0b4",
      accent: "#7c8cff",
      accent2: "#7c8cff",
      success: "#7ee787",
      warning: "#ffb86c",
      surface: "#17182f",
      border: "#343852",
      captionBg: "#070a12",
      captionFg: "#ffffff",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#7c8cff", "#56d4bc", "#ffb86c", "#ff7b9c", "#79c0ff"],
  },
  paper: {
    preset: "paper",
    mode: "paper",
    colors: {
      bg: "#f7f4ec",
      fg: "#191b29",
      subtle: "#5d6275",
      accent: "#2563eb",
      accent2: "#7c3aed",
      success: "#2ea043",
      warning: "#b7791f",
      surface: "#ffffff",
      border: "#d0d7de",
      captionBg: "#111827",
      captionFg: "#f8fafc",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#2563eb", "#7c3aed", "#059669", "#d97706", "#db2777"],
  },
  neutral: {
    preset: "neutral",
    mode: "neutral",
    colors: {
      bg: "#111827",
      fg: "#f9fafb",
      subtle: "#9ca3af",
      accent: "#38bdf8",
      accent2: "#818cf8",
      success: "#34d399",
      warning: "#f59e0b",
      surface: "#1f2937",
      border: "#374151",
      captionBg: "#030712",
      captionFg: "#f9fafb",
    },
    typography: DEFAULT_TYPOGRAPHY,
    chart: ["#38bdf8", "#818cf8", "#34d399", "#f59e0b", "#f472b6"],
  },
};

export function themePresetManifest(): Array<
  ResolvedBundleTheme & { id: BundleThemePreset; description: string; default: boolean }
> {
  return (Object.keys(THEME_PRESETS) as BundleThemePreset[]).map((preset) => ({
    id: preset,
    description: THEME_PRESET_GUIDE[preset],
    default: preset === DEFAULT_PRESET,
    ...THEME_PRESETS[preset],
  }));
}

function err(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
}

const DEFAULT_PRESET: BundleThemePreset = "ink";

function presetForMode(mode: BundleThemeMode | undefined): BundleThemePreset {
  if (mode === "paper") return "paper";
  if (mode === "neutral") return "neutral";
  return DEFAULT_PRESET;
}

function modeForPreset(preset: BundleThemePreset): BundleThemeMode {
  return THEME_PRESETS[preset].mode;
}

export function resolveBundleTheme(theme?: BundleTheme): ResolvedBundleTheme {
  const preset = theme?.preset ?? presetForMode(theme?.mode);
  const base = THEME_PRESETS[preset];
  return {
    preset,
    mode: base.mode,
    colors: { ...base.colors, ...theme?.colors },
    typography: { ...base.typography, ...theme?.typography },
    chart: theme?.chart ?? base.chart,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16) / 255,
    g: parseInt(normalized.slice(2, 4), 16) / 255,
    b: parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

function linearize(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(a: string, b: string): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

export function validateThemeContrast(
  spec: { meta: { theme?: BundleTheme } },
  errors: BundleError[],
  warnings: BundleError[],
): void {
  if (
    spec.meta.theme?.preset &&
    spec.meta.theme.mode &&
    spec.meta.theme.mode !== modeForPreset(spec.meta.theme.preset)
  ) {
    errors.push(
      err(
        "CONFLICTING_THEME_MODE",
        "meta.theme.mode",
        `Theme preset "${spec.meta.theme.preset}" conflicts with mode "${spec.meta.theme.mode}".`,
        "Remove mode or set it to the preset's matching mode; prefer authoring with preset only.",
      ),
    );
  }
  for (const [role, family] of Object.entries(spec.meta.theme?.typography ?? {})) {
    if (family && !REGISTERED_FONTS.has(family)) {
      warnings.push(
        err(
          "UNKNOWN_THEME_FONT",
          `meta.theme.typography.${role}`,
          `Font family "${family}" is not one of the renderer's registered deterministic fonts.`,
          'Use "Inter", "Inter Bold", or "JetBrains Mono", or ensure the renderer registers this font before render.',
        ),
      );
    }
  }
  const theme = resolveBundleTheme(spec.meta.theme);
  const lowContrast = (a: string, b: string, min: number) => contrastRatio(a, b) < min;
  if (lowContrast(theme.colors.fg, theme.colors.bg, 4.5)) {
    errors.push(
      err(
        "LOW_THEME_CONTRAST",
        "meta.theme.colors",
        `Theme foreground/background contrast is too low (${contrastRatio(theme.colors.fg, theme.colors.bg).toFixed(2)}:1).`,
        "Use colors with at least 4.5:1 contrast for fg on bg.",
      ),
    );
  }
  if (lowContrast(theme.colors.captionFg, theme.colors.captionBg, 4.5)) {
    errors.push(
      err(
        "LOW_CAPTION_CONTRAST",
        "meta.theme.colors",
        `Caption foreground/background contrast is too low (${contrastRatio(theme.colors.captionFg, theme.colors.captionBg).toFixed(2)}:1).`,
        "Use colors with at least 4.5:1 contrast for captionFg on captionBg.",
      ),
    );
  }
  if (spec.meta.theme && lowContrast(theme.colors.accent, theme.colors.bg, 3)) {
    warnings.push(
      err(
        "WEAK_ACCENT_CONTRAST",
        "meta.theme.colors.accent",
        `Accent contrast against bg is weak (${contrastRatio(theme.colors.accent, theme.colors.bg).toFixed(2)}:1).`,
        "For legible accent labels, pick an accent with at least 3:1 contrast against bg.",
      ),
    );
  }
}
