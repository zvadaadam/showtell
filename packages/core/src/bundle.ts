import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { readFileAtRef, repoRelativeFile, resolveDiff } from "./repo.ts";
import { AspectRatio, TtsConfig } from "./spec.ts";
import { parseBundleTimePointRef, parseBundleTimeSpanRef, type BundleTimeSpanValue } from "./bundle-time.ts";
import { SafeFileError, safeExistingFileInRoot } from "./safe-files.ts";
import {
  loadHyperframeContractFromSource,
  validateJsonSchemaValue,
  type BundleHyperframeInput,
  type HyperframeContract,
} from "./hyperframe-contract.ts";

const Id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, "Use 1-64 chars: letters, digits, underscore, hyphen; start with a letter.");

const Duration = z.literal("auto");
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use 6-digit hex colors like #7c8cff.");
const FontFamily = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_. -]+$/, "Use one plain font family name, not CSS, quotes, commas, or a URL.");
const ThemePreset = z.enum(["agent-dark", "paper", "neutral"]);
const ThemeMode = z.enum(["dark", "paper", "neutral"]);
const REGISTERED_FONTS = new Set(["Inter", "Inter Bold", "JetBrains Mono"]);

const Theme = z
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

const Asset = z.discriminatedUnion("type", [
  z.object({ type: z.literal("audio"), src: z.string().min(1) }).strict(),
  z.object({ type: z.literal("data"), src: z.string().min(1) }).strict(),
  z.object({ type: z.literal("image"), src: z.string().min(1) }).strict(),
]);

const Captions = z
  .object({
    mode: z.enum(["off", "sidecar", "burn-in", "sidecar-and-burn-in"]).default("off"),
    source: z.literal("narration").default("narration"),
  })
  .strict();

const Music = z
  .object({
    id: Id,
    asset: Id,
    range: z.union([z.string().min(1), z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()]),
    loop: z.boolean().default(false),
    gainDb: z.number().max(0).default(-28),
    duckUnderNarration: z.boolean().default(false),
    fadeInMs: z.number().min(0).default(0),
    fadeOutMs: z.number().min(0).default(0),
  })
  .strict();

const RepoRef = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("code"),
      file: z.string().min(1),
      lineStart: z.number().int().positive().optional(),
      lineEnd: z.number().int().positive().optional(),
      ref: z.string().optional(),
      focus: z.array(z.number().int().positive()).optional(),
      language: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("diff"),
      file: z.string().min(1),
      ref: z.string().min(1),
    })
    .strict(),
]);

const NarrationLine = z.object({ id: Id, text: z.string().min(1) }).strict();
const Beat = z.object({ id: Id, lines: z.array(Id).min(1) }).strict();
const Anchor = z.object({ id: Id, at: z.string().min(1) }).strict();
const Range = z.union([z.string().min(1), z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()]);
const VisualInputValue = Range;

const Visual = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("hyperframe"),
      src: z.string().min(1),
      export: z.literal("default").default("default"),
      props: z.record(z.unknown()).default({}),
      inputs: z.record(Id, VisualInputValue).default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal("builtin"),
      name: z.enum(["title", "code", "diff", "talking-points", "chart", "screencap"]),
      ref: Id.optional(),
      props: z.record(z.unknown()).default({}),
    })
    .strict(),
]);

const Scene = z
  .object({
    id: Id,
    duration: Duration.default("auto"),
    narration: z.object({ lines: z.array(NarrationLine).min(1) }).strict(),
    refs: z.record(Id, RepoRef).default({}),
    beats: z.array(Beat).default([]),
    anchors: z.array(Anchor).default([]),
    ranges: z.record(Id, Range).default({}),
    visual: Visual,
  })
  .strict();

export const BundleSpec = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(2),
    meta: z
      .object({
        title: z.string().min(1),
        fps: z.number().int().min(1).max(120).default(30),
        aspectRatios: z.array(AspectRatio).min(1).default(["16:9"]),
        theme: Theme.optional(),
        repo: z
          .object({ path: z.string().default(".."), baseRef: z.string().optional(), headRef: z.string().optional() })
          .strict()
          .default({ path: ".." }),
      })
      .strict(),
    assets: z.record(Id, Asset).default({}),
    audio: z
      .object({
        tts: TtsConfig.default({ provider: "say" }),
        captions: Captions.default({ mode: "off", source: "narration" }),
        music: z.array(Music).default([]),
      })
      .strict()
      .default({ tts: { provider: "say" }, captions: { mode: "off", source: "narration" }, music: [] }),
    scenes: z.array(Scene).min(1),
  })
  .strict();

export type BundleSpec = z.infer<typeof BundleSpec>;
export type BundleScene = z.infer<typeof Scene>;
export type BundleRepoRef = z.infer<typeof RepoRef>;
export type BundleAsset = z.infer<typeof Asset>;
export type BundleMusic = z.infer<typeof Music>;
export type BundleBeat = z.infer<typeof Beat>;
export type BundleVisualInputValue = z.infer<typeof VisualInputValue>;
export type { BundleHyperframeInput, HyperframeContract };

export interface BundleError {
  code: string;
  path: string;
  message: string;
  hint: string;
}

export type BundleValidationResult =
  | { ok: true; spec: BundleSpec; bundleDir: string; repoPath: string; warnings: BundleError[] }
  | { ok: false; errors: BundleError[]; warnings: BundleError[] };

function issuePath(path: (string | number)[]): string {
  return path.length ? path.join(".") : "(root)";
}

function err(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
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

function validateThemeContrast(
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

const MAX_ASSET_BYTES: Record<BundleAsset["type"], number> = {
  audio: 200 * 1024 * 1024,
  data: 5 * 1024 * 1024,
  image: 50 * 1024 * 1024,
};

const MAX_HYPERFRAME_BYTES = 1024 * 1024;

export function bundleAssetFile(bundleDir: string, asset: BundleAsset): { path: string; bytes: number } {
  return safeExistingFileInRoot(bundleDir, asset.src, { maxBytes: MAX_ASSET_BYTES[asset.type] });
}

export function bundleHyperframeFile(bundleDir: string, src: string): { path: string; bytes: number } {
  return safeExistingFileInRoot(bundleDir, src, { maxBytes: MAX_HYPERFRAME_BYTES });
}

export function resolveBundleRepoPath(bundleDir: string, spec: BundleSpec): string {
  return isAbsolute(spec.meta.repo.path) ? resolve(spec.meta.repo.path) : resolve(bundleDir, spec.meta.repo.path);
}

export function effectiveBeats(scene: BundleScene): BundleBeat[] {
  return scene.beats.length
    ? scene.beats
    : scene.narration.lines.map((line) => ({
        id: line.id,
        lines: [line.id],
      }));
}

function checkUnique(ids: string[], path: string, errors: BundleError[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      errors.push(
        err(
          "DUPLICATE_ID",
          path,
          `Duplicate ${label} id "${id}".`,
          "Use stable IDs, but make each ID unique in its scope.",
        ),
      );
    }
    seen.add(id);
  }
}

function targetScene(
  currentScene: BundleScene,
  scenes: BundleScene[],
  sceneId: string | undefined,
): BundleScene | undefined {
  return sceneId ? scenes.find((scene) => scene.id === sceneId) : currentScene;
}

function sceneHasId(
  scene: BundleScene | undefined,
  kind: "scene" | "line" | "beat" | "anchor" | "range",
  id?: string,
): boolean {
  if (!scene) return false;
  if (kind === "scene") return true;
  if (!id) return false;
  if (kind === "line") return scene.narration.lines.some((line) => line.id === id);
  if (kind === "beat") return effectiveBeats(scene).some((beat) => beat.id === id);
  if (kind === "anchor") return scene.anchors.some((anchor) => anchor.id === id);
  return Object.prototype.hasOwnProperty.call(scene.ranges, id);
}

function checkPointRef(
  ref: string,
  path: string,
  currentScene: BundleScene,
  scenes: BundleScene[],
  errors: BundleError[],
): void {
  const parsed = parseBundleTimePointRef(ref);
  const fail = () =>
    errors.push(
      err(
        "UNKNOWN_TIME_REF",
        path,
        `Unknown point reference "${ref}".`,
        "Point refs must target an existing scene, line, beat, range, or anchor.",
      ),
    );
  if (!parsed) {
    fail();
    return;
  }
  if (parsed.kind === "video") return;
  if (parsed.kind === "scene") {
    if (sceneHasId(targetScene(currentScene, scenes, parsed.sceneId), "scene")) return;
    fail();
    return;
  }
  const scene = targetScene(currentScene, scenes, parsed.sceneId);
  if (sceneHasId(scene, parsed.kind, parsed.id)) return;
  fail();
}

function checkSpanRef(
  ref: string,
  path: string,
  currentScene: BundleScene,
  scenes: BundleScene[],
  errors: BundleError[],
): void {
  const parsed = parseBundleTimeSpanRef(ref);
  const fail = () =>
    errors.push(
      err(
        "UNKNOWN_TIME_REF",
        path,
        `Unknown span reference "${ref}".`,
        "Span refs must target an existing scene, line, beat, or range.",
      ),
    );
  if (!parsed) {
    fail();
    return;
  }
  if (parsed.kind === "video") return;
  if (parsed.kind === "scene") {
    if (sceneHasId(targetScene(currentScene, scenes, parsed.sceneId), "scene")) return;
    fail();
    return;
  }
  const scene = targetScene(currentScene, scenes, parsed.sceneId);
  if (sceneHasId(scene, parsed.kind, parsed.id)) return;
  fail();
}

function checkSpanValue(
  value: BundleTimeSpanValue,
  path: string,
  currentScene: BundleScene,
  scenes: BundleScene[],
  errors: BundleError[],
): void {
  if (typeof value === "string") {
    checkSpanRef(value, path, currentScene, scenes, errors);
    return;
  }
  checkPointRef(value.from, `${path}.from`, currentScene, scenes, errors);
  checkPointRef(value.to, `${path}.to`, currentScene, scenes, errors);
}

function validateTimeRefs(scene: BundleScene, sceneIndex: number, scenes: BundleScene[], errors: BundleError[]): void {
  effectiveBeats(scene).forEach((beat, beatIndex) => {
    const indices = beat.lines.map((id) => scene.narration.lines.findIndex((line) => line.id === id));
    if (indices.some((i) => i < 0)) {
      errors.push(
        err(
          "UNKNOWN_LINE",
          `scenes.${sceneIndex}.beats.${beatIndex}.lines`,
          `Beat "${beat.id}" references an unknown line.`,
          "Use line IDs from this scene's narration.lines array.",
        ),
      );
      return;
    }
    const sorted = [...indices].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1]! + 1) {
        errors.push(
          err(
            "NON_CONTIGUOUS_BEAT_LINES",
            `scenes.${sceneIndex}.beats.${beatIndex}.lines`,
            `Beat "${beat.id}" lines are not contiguous.`,
            "A beat must map to adjacent narration lines so timing can be compiled deterministically.",
          ),
        );
        break;
      }
    }
  });

  scene.anchors.forEach((anchor, i) =>
    checkPointRef(anchor.at, `scenes.${sceneIndex}.anchors.${i}.at`, scene, scenes, errors),
  );
  Object.entries(scene.ranges).forEach(([name, value]) => {
    checkSpanValue(value, `scenes.${sceneIndex}.ranges.${name}`, scene, scenes, errors);
  });
}

function validateHyperframeSource(text: string, path: string, errors: BundleError[]): void {
  const banned = [
    ["Date.now", "Use ctx.time instead of Date.now()."],
    ["new Date", "Use ctx.time instead of wall-clock dates."],
    ["performance.now", "Use ctx.time instead of performance.now()."],
    ["Math.random", "Use ctx.random(key) for deterministic randomness."],
    ["crypto.randomUUID", "Use ctx.random(key) for deterministic randomness."],
    ["fetch(", "Hyperframes cannot call the network; declare assets in spec.json."],
    ["readFile", "Hyperframes cannot read files; declare assets or repo refs."],
    ["require(", "Hyperframes cannot import modules dynamically; use @agent-video/hyperframes only."],
    ["process.", "Hyperframes cannot inspect process state."],
    ["globalThis", "Hyperframes cannot reach ambient globals; use renderer-provided ctx."],
    ["setTimeout", "Hyperframes cannot use timers; animate from ctx.time."],
    ["setInterval", "Hyperframes cannot use timers; animate from ctx.time."],
    ["await ", "Hyperframes must be synchronous; use declared inputs resolved by the renderer."],
    ["node:", "Hyperframes cannot import Node built-ins."],
    ["child_process", "Hyperframes cannot run subprocesses."],
    ["import(", "Hyperframes cannot use dynamic imports."],
    ["import.meta", "Hyperframes cannot inspect import metadata."],
    ["eval(", "Hyperframes cannot use eval."],
    ["Function(", "Hyperframes cannot construct functions dynamically."],
  ] as const;
  for (const [needle, hint] of banned) {
    if (text.includes(needle)) {
      errors.push(err("BANNED_HYPERFRAME_API", path, `Hyperframe uses banned API "${needle}".`, hint));
    }
  }
  const importPattern = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier && specifier !== "@agent-video/hyperframes") {
      errors.push(
        err(
          "BANNED_HYPERFRAME_IMPORT",
          path,
          `Hyperframe imports unsupported module "${specifier}".`,
          'Hyperframes may import only from "@agent-video/hyperframes"; declare assets and repo refs in spec.json.',
        ),
      );
    }
  }
  if (!text.includes("export default") || !text.includes("propsSchema") || !text.includes("inputs")) {
    errors.push(
      err(
        "INVALID_HYPERFRAME_EXPORT",
        path,
        "Hyperframe must default-export { schemaVersion, propsSchema, inputs, render }.",
        "Use the canonical module shape from docs/bundle-v2.md.",
      ),
    );
  }
}

function validateHyperframeContractShape(
  text: string,
  path: string,
  errors: BundleError[],
): HyperframeContract | undefined {
  try {
    return loadHyperframeContractFromSource(text);
  } catch (e) {
    errors.push(
      err(
        "INVALID_HYPERFRAME_CONTRACT",
        path,
        `Invalid hyperframe contract: ${(e as Error).message}`,
        "Declare literal const propsSchema and inputs objects in the hyperframe module.",
      ),
    );
    return undefined;
  }
}

function validateHyperframeInputs(
  scene: BundleScene,
  sceneIndex: number,
  contract: HyperframeContract,
  assets: BundleSpec["assets"],
  scenes: BundleScene[],
  errors: BundleError[],
): void {
  if (scene.visual.kind !== "hyperframe") return;

  for (const issue of validateJsonSchemaValue(
    contract.propsSchema,
    scene.visual.props,
    `scenes.${sceneIndex}.visual.props`,
  )) {
    errors.push(
      err("BAD_HYPERFRAME_PROPS", issue.path, issue.message, "Fix visual.props to match the hyperframe's propsSchema."),
    );
  }

  for (const input of Object.keys(scene.visual.inputs)) {
    if (!Object.prototype.hasOwnProperty.call(contract.inputs, input)) {
      errors.push(
        err(
          "UNKNOWN_HYPERFRAME_INPUT",
          `scenes.${sceneIndex}.visual.inputs.${input}`,
          `Hyperframe does not declare input "${input}".`,
          "Use an input name from the hyperframe's literal inputs object or remove this mapping.",
        ),
      );
    }
  }

  for (const [input, binding] of Object.entries(contract.inputs)) {
    const value = scene.visual.inputs[input];
    const path = `scenes.${sceneIndex}.visual.inputs.${input}`;
    if (value === undefined) {
      if (binding.optional) continue;
      errors.push(
        err(
          "MISSING_HYPERFRAME_INPUT",
          path,
          `Missing required hyperframe input "${input}".`,
          "Map this input to a scene ref, top-level asset, named range, or time span.",
        ),
      );
      continue;
    }

    if (binding.kind === "repo") {
      if (typeof value !== "string") {
        errors.push(
          err(
            "BAD_HYPERFRAME_INPUT",
            path,
            `Repo input "${input}" must be a string ref id.`,
            "Point this input at a key in the scene's refs object.",
          ),
        );
        continue;
      }
      const ref = scene.refs[value];
      if (!ref) {
        errors.push(
          err(
            "UNKNOWN_REPO_REF",
            path,
            `Unknown repo ref "${value}".`,
            "Point this input at a key in the scene's refs object.",
          ),
        );
      } else if (binding.refKind && ref.kind !== binding.refKind) {
        errors.push(
          err(
            "WRONG_REPO_REF_KIND",
            path,
            `Expected "${value}" to be a ${binding.refKind} ref.`,
            "Use the requested ref kind or change the hyperframe input contract.",
          ),
        );
      }
    } else if (binding.kind === "asset") {
      if (typeof value !== "string") {
        errors.push(
          err(
            "BAD_HYPERFRAME_INPUT",
            path,
            `Asset input "${input}" must be a string asset id.`,
            "Point this input at a key in the top-level assets object.",
          ),
        );
        continue;
      }
      const asset = assets[value];
      if (!asset) {
        errors.push(
          err(
            "UNKNOWN_ASSET",
            path,
            `Unknown asset "${value}".`,
            "Point this input at a key in the top-level assets object.",
          ),
        );
      } else if (binding.assetType && asset.type !== binding.assetType) {
        errors.push(
          err(
            "WRONG_ASSET_TYPE",
            path,
            `Expected "${value}" to be a ${binding.assetType} asset.`,
            "Use the requested asset type or change the hyperframe input contract.",
          ),
        );
      }
    } else if (typeof value === "string" && Object.prototype.hasOwnProperty.call(scene.ranges, value)) {
      continue;
    } else {
      checkSpanValue(value, path, scene, scenes, errors);
    }
  }
}

function safeFileErrorCode(e: unknown): string | undefined {
  return e instanceof SafeFileError ? e.code : undefined;
}

/** Validate a bundle directory and return a parsed spec plus resolved root paths. */
export function validateBundle(bundleDirInput: string): BundleValidationResult {
  const bundleDir = resolve(bundleDirInput);
  const errors: BundleError[] = [];
  const warnings: BundleError[] = [];
  const specPath = resolve(bundleDir, "spec.json");
  if (!existsSync(specPath)) {
    return {
      ok: false,
      errors: [
        err(
          "MISSING_SPEC",
          "spec.json",
          "Bundle is missing spec.json.",
          "Pass a bundle directory that contains a v2 spec.json.",
        ),
      ],
      warnings,
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(specPath, "utf-8"));
  } catch (e) {
    return {
      ok: false,
      errors: [err("INVALID_JSON", "spec.json", `Invalid JSON: ${(e as Error).message}`, "Fix spec.json syntax.")],
      warnings,
    };
  }

  const parsed = BundleSpec.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        err("SCHEMA_ERROR", issuePath(issue.path), issue.message, "Fix the field to match docs/bundle-v2.md."),
      ),
      warnings,
    };
  }

  const spec = parsed.data;
  validateThemeContrast(spec, errors, warnings);
  const repoPath = resolveBundleRepoPath(bundleDir, spec);
  if (!existsSync(repoPath)) {
    errors.push(
      err(
        "MISSING_REPO",
        "meta.repo.path",
        `Repo path does not exist: ${repoPath}`,
        "Set meta.repo.path relative to the bundle directory.",
      ),
    );
  }

  checkUnique(
    spec.scenes.map((s) => s.id),
    "scenes",
    errors,
    "scene",
  );

  Object.entries(spec.assets).forEach(([id, asset]) => {
    try {
      bundleAssetFile(bundleDir, asset);
    } catch (e) {
      const code = safeFileErrorCode(e) === "MISSING_FILE" ? "MISSING_ASSET" : "BAD_ASSET_PATH";
      errors.push(
        err(
          code,
          `assets.${id}.src`,
          (e as Error).message,
          code === "MISSING_ASSET"
            ? "Create the asset file or update the src path."
            : "Asset paths must be bundle-relative regular files, stay inside the bundle, and fit type size limits.",
        ),
      );
    }
  });

  spec.audio.music.forEach((music, i) => {
    const asset = spec.assets[music.asset];
    if (!asset) {
      errors.push(
        err(
          "UNKNOWN_MUSIC_ASSET",
          `audio.music.${i}.asset`,
          `Unknown music asset "${music.asset}".`,
          "Add the asset to top-level assets or fix the asset id.",
        ),
      );
    } else if (asset.type !== "audio") {
      errors.push(
        err(
          "MUSIC_ASSET_NOT_AUDIO",
          `audio.music.${i}.asset`,
          `Music asset "${music.asset}" is not audio.`,
          'Use an asset with type "audio".',
        ),
      );
    }
    checkSpanValue(music.range, `audio.music.${i}.range`, spec.scenes[0]!, spec.scenes, errors);
  });

  spec.scenes.forEach((scene, sceneIndex) => {
    checkUnique(
      scene.narration.lines.map((l) => l.id),
      `scenes.${sceneIndex}.narration.lines`,
      errors,
      "line",
    );
    checkUnique(
      scene.beats.map((b) => b.id),
      `scenes.${sceneIndex}.beats`,
      errors,
      "beat",
    );
    checkUnique(
      scene.anchors.map((a) => a.id),
      `scenes.${sceneIndex}.anchors`,
      errors,
      "anchor",
    );
    validateTimeRefs(scene, sceneIndex, spec.scenes, errors);

    Object.entries(scene.refs).forEach(([id, ref]) => {
      try {
        repoRelativeFile(ref.file);
        if (repoPath && existsSync(repoPath)) {
          if (ref.kind === "code") readFileAtRef(repoPath, ref.file, ref.ref);
          else resolveDiff(repoPath, { file: ref.file, ref: ref.ref, animation: "magic-move" });
        }
      } catch (e) {
        errors.push(
          err(
            "BAD_REPO_REF",
            `scenes.${sceneIndex}.refs.${id}`,
            `Could not resolve ${ref.kind} ref: ${(e as Error).message}`,
            "Use a repo-relative file path and a valid git ref/range.",
          ),
        );
      }
    });

    if (scene.visual.kind === "hyperframe") {
      try {
        let hyperframePath: string | undefined;
        try {
          hyperframePath = bundleHyperframeFile(bundleDir, scene.visual.src).path;
        } catch (e) {
          const code = safeFileErrorCode(e) === "MISSING_FILE" ? "MISSING_HYPERFRAME" : "BAD_HYPERFRAME_PATH";
          errors.push(
            err(
              code,
              `scenes.${sceneIndex}.visual.src`,
              (e as Error).message,
              code === "MISSING_HYPERFRAME"
                ? "Create the hyperframe file under the bundle."
                : "Hyperframe paths must be bundle-relative regular files and stay inside the bundle.",
            ),
          );
        }
        if (hyperframePath) {
          const text = readFileSync(hyperframePath, "utf-8");
          validateHyperframeSource(text, `scenes.${sceneIndex}.visual.src`, errors);
          const contract = validateHyperframeContractShape(text, `scenes.${sceneIndex}.visual.src`, errors);
          if (contract) validateHyperframeInputs(scene, sceneIndex, contract, spec.assets, spec.scenes, errors);
        }
      } catch (e) {
        errors.push(
          err(
            "BAD_HYPERFRAME_PATH",
            `scenes.${sceneIndex}.visual.src`,
            `Bad hyperframe path: ${(e as Error).message}`,
            "Hyperframe paths must be bundle-relative and stay inside the bundle.",
          ),
        );
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, spec, bundleDir, repoPath, warnings };
}
