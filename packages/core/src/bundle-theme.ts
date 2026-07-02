/** Bundle v2 theme defaults and validation. */
import { z } from "zod";
import type { BundleError } from "./bundle.ts";

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use 6-digit hex colors like #7c8cff.");
const FontFamily = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_. -]+$/, "Use one plain font family name, not CSS, quotes, commas, or a URL.");
const ThemePreset = z.enum(["agent-dark", "paper", "neutral"]);
const ThemeMode = z.enum(["dark", "paper", "neutral"]);
const REGISTERED_FONTS = new Set(["Inter", "Inter Bold", "JetBrains Mono"]);

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
}

const THEME_PRESETS: Record<BundleThemePreset, ResolvedBundleTheme> = {
  "agent-dark": {
    preset: "agent-dark",
    mode: "dark",
    colors: {
      bg: "#0f0f23",
      fg: "#e8e8f2",
      subtle: "#9aa0b4",
      accent: "#7c8cff",
      success: "#7ee787",
      warning: "#ffb86c",
      surface: "#17182f",
      border: "#343852",
      captionBg: "#070a12",
      captionFg: "#ffffff",
    },
    typography: { display: "Inter Bold", body: "Inter", mono: "JetBrains Mono" },
  },
  paper: {
    preset: "paper",
    mode: "paper",
    colors: {
      bg: "#f7f4ec",
      fg: "#191b29",
      subtle: "#5d6275",
      accent: "#2563eb",
      success: "#2ea043",
      warning: "#b7791f",
      surface: "#ffffff",
      border: "#d0d7de",
      captionBg: "#111827",
      captionFg: "#f8fafc",
    },
    typography: { display: "Inter Bold", body: "Inter", mono: "JetBrains Mono" },
  },
  neutral: {
    preset: "neutral",
    mode: "neutral",
    colors: {
      bg: "#111827",
      fg: "#f9fafb",
      subtle: "#9ca3af",
      accent: "#38bdf8",
      success: "#34d399",
      warning: "#f59e0b",
      surface: "#1f2937",
      border: "#374151",
      captionBg: "#030712",
      captionFg: "#f9fafb",
    },
    typography: { display: "Inter Bold", body: "Inter", mono: "JetBrains Mono" },
  },
};

function err(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
}

function presetForMode(mode: BundleThemeMode | undefined): BundleThemePreset {
  if (mode === "paper") return "paper";
  if (mode === "neutral") return "neutral";
  return "agent-dark";
}

function modeForPreset(preset: BundleThemePreset): BundleThemeMode {
  if (preset === "paper") return "paper";
  if (preset === "neutral") return "neutral";
  return "dark";
}

export function resolveBundleTheme(theme?: BundleTheme): ResolvedBundleTheme {
  const preset = theme?.preset ?? presetForMode(theme?.mode);
  const base = THEME_PRESETS[preset];
  return {
    preset,
    mode: base.mode,
    colors: { ...base.colors, ...theme?.colors },
    typography: { ...base.typography, ...theme?.typography },
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
