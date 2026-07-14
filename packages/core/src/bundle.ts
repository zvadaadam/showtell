import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { repoRelativeFile, resolveCodeRef, resolveDiff } from "./repo.ts";
import { AspectRatio, ScreencapPlayback, TtsConfig } from "./spec.ts";
import { parseBundleTimePointRef, parseBundleTimeSpanRef, type BundleTimeSpanValue } from "./bundle-time.ts";
import { Theme, validateThemeContrast } from "./bundle-theme.ts";
import { validateWebSource } from "./web-lint.ts";
import { parseWebDocument, type WebDocument } from "./web-document.ts";
import { ID_PATTERN } from "./id.ts";
import { SafeFileError, safeExistingFileInRoot } from "./safe-files.ts";
import { validateJsonSchemaValue } from "./props-schema.ts";
import { loadWebManifestFromSource, WebManifestError, type WebManifest } from "./web-manifest.ts";

const Id = z
  .string()
  .regex(new RegExp(`^${ID_PATTERN}$`), "Use 1-64 chars: letters, digits, underscore, hyphen; start with a letter.");

const Duration = z
  .union([z.literal("auto"), z.number().positive()])
  .describe('Seconds, or "auto" to derive the scene timing from measured narration audio.');
export type { BundleTheme, BundleThemeMode, BundleThemePreset, ResolvedBundleTheme } from "./bundle-theme.ts";
export {
  resolveBundleTheme,
  themePresetManifest,
  THEME_PRESET_GUIDE,
  REGISTERED_FONT_FAMILIES,
} from "./bundle-theme.ts";

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

/**
 * Always-on presenter bubble: the user's avatar with a circular model badge,
 * drawn by the renderer on every frame and pulsing with narration loudness.
 * `position: "auto"` picks the top-right corner on landscape/square frames and
 * top-center on 9:16.
 */
const Presenter = z
  .object({
    enabled: z.boolean().default(true),
    /** Bundle-relative path to the presenter avatar image (rendered circular). */
    image: z.string().min(1),
    /** Model that authored the video; badge monogram fallback when no logo. */
    model: z.string().min(1).optional(),
    /** Bundle-relative path to the model logo image for the circular badge. */
    logo: z.string().min(1).optional(),
    position: z.enum(["auto", "top-left", "top-center", "top-right", "bottom-left", "bottom-right"]).default("auto"),
    size: z.enum(["sm", "md", "lg"]).default("md"),
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

const WebVisual = z
  .object({
    kind: z.literal("web"),
    src: z.string().min(1),
    name: z.never().optional(),
    ref: z.never().optional(),
    props: z.record(z.unknown()).default({}),
    inputs: z.record(Id, VisualInputValue).default({}),
  })
  .strict();

const ScreencapVisual = z
  .object({
    kind: z.literal("screencap"),
    sessionRef: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, "A capture session id (letters/digits/_/-, max 64); not a path."),
    clip: z
      .object({ start: z.number().min(0), end: z.number().positive() })
      .strict()
      .refine((clip) => clip.end > clip.start, {
        message: "clip.end must be greater than clip.start.",
      })
      .optional(),
    playback: ScreencapPlayback.optional(),
  })
  .strict();

const BundleVisual = z.discriminatedUnion("kind", [WebVisual, ScreencapVisual]);

const SceneBase = z
  .object({
    id: Id,
    duration: Duration.default("auto"),
    narration: z.object({ lines: z.array(NarrationLine).min(1) }).strict(),
    refs: z.record(Id, RepoRef).default({}),
    beats: z.array(Beat).default([]),
    anchors: z.array(Anchor).default([]),
    ranges: z.record(Id, Range).default({}),
  })
  .strict();

const BundleSceneSchema = SceneBase.extend({ visual: BundleVisual }).strict();

const BundleMeta = z
  .object({
    title: z.string().min(1),
    fps: z.number().int().min(1).max(120).default(30),
    aspectRatios: z.array(AspectRatio).min(1).default(["16:9"]),
    theme: Theme.optional(),
    presenter: Presenter.optional(),
    repo: z
      .object({ path: z.string().default(".."), baseRef: z.string().optional(), headRef: z.string().optional() })
      .strict()
      .default({ path: ".." }),
  })
  .strict();

const BundleAudio = z
  .object({
    tts: TtsConfig.default({ provider: "say" }),
    captions: Captions.default({ mode: "off", source: "narration" }),
    music: z.array(Music).default([]),
  })
  .strict()
  .default({ tts: { provider: "say" }, captions: { mode: "off", source: "narration" }, music: [] });

const BundleSpecBase = z
  .object({
    $schema: z.string().optional(),
    meta: BundleMeta,
    assets: z.record(Id, Asset).default({}),
    audio: BundleAudio,
  })
  .strict();

export const BundleSpec = BundleSpecBase.extend({
  version: z.literal(3),
  scenes: z.array(BundleSceneSchema).min(1),
}).strict();

export type BundleSpec = z.infer<typeof BundleSpec>;
export type BundlePresenter = z.infer<typeof Presenter>;
export type BundleScene = z.infer<typeof BundleSceneSchema>;
export type BundleRepoRef = z.infer<typeof RepoRef>;
export type BundleAsset = z.infer<typeof Asset>;
export type BundleMusic = z.infer<typeof Music>;
export type BundleBeat = z.infer<typeof Beat>;
export type BundleVisualInputValue = z.infer<typeof VisualInputValue>;
export type BundleWebVisual = z.infer<typeof WebVisual>;
export type BundleScreencapVisual = z.infer<typeof ScreencapVisual>;
export type { WebManifest };

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

const MAX_ASSET_BYTES: Record<BundleAsset["type"], number> = {
  audio: 200 * 1024 * 1024,
  data: 5 * 1024 * 1024,
  image: 50 * 1024 * 1024,
};

const MAX_WEB_BYTES = 2 * 1024 * 1024;

export function bundleAssetFile(bundleDir: string, asset: BundleAsset): { path: string; bytes: number } {
  return safeExistingFileInRoot(bundleDir, asset.src, { maxBytes: MAX_ASSET_BYTES[asset.type] });
}

export function bundleWebFile(bundleDir: string, src: string): { path: string; bytes: number } {
  return safeExistingFileInRoot(bundleDir, src, { maxBytes: MAX_WEB_BYTES });
}

export function bundlePresenterImageFile(bundleDir: string, src: string): { path: string; bytes: number } {
  return safeExistingFileInRoot(bundleDir, src, { maxBytes: MAX_ASSET_BYTES.image });
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

function validateWebInputs(
  scene: BundleScene,
  sceneIndex: number,
  manifest: WebManifest,
  assets: BundleSpec["assets"],
  scenes: BundleScene[],
  errors: BundleError[],
): void {
  if (scene.visual.kind !== "web") return;
  const { props, inputs: inputValues } = scene.visual;
  for (const issue of validateJsonSchemaValue(
    manifest.propsSchema,
    props,
    `scenes.${sceneIndex}.visual.props`,
    `scenes.${sceneIndex}.visual.src.propsSchema`,
  )) {
    errors.push(
      issue.kind === "schema"
        ? err(
            "BAD_WEB_SCHEMA",
            `scenes.${sceneIndex}.visual.src`,
            `Invalid web propsSchema at ${issue.path}: ${issue.message}`,
            "Fix the web manifest's propsSchema.",
          )
        : err("BAD_WEB_PROPS", issue.path, issue.message, "Fix visual.props to match the web manifest's propsSchema."),
    );
  }

  for (const input of Object.keys(inputValues)) {
    if (!Object.prototype.hasOwnProperty.call(manifest.inputs, input)) {
      errors.push(
        err(
          "UNKNOWN_WEB_INPUT",
          `scenes.${sceneIndex}.visual.inputs.${input}`,
          `Web manifest does not declare input "${input}".`,
          "Use an input name from the web manifest's inputs object or remove this mapping.",
        ),
      );
    }
  }

  for (const [input, binding] of Object.entries(manifest.inputs)) {
    const value = inputValues[input];
    const path = `scenes.${sceneIndex}.visual.inputs.${input}`;
    if (value === undefined) {
      if (binding.optional) continue;
      errors.push(
        err(
          "MISSING_WEB_INPUT",
          path,
          `Missing required web input "${input}".`,
          "Map this input to a scene ref, top-level asset, named range, or time span.",
        ),
      );
      continue;
    }

    if (binding.kind === "repo") {
      if (typeof value !== "string") {
        errors.push(
          err(
            "BAD_WEB_INPUT",
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
            "Use the requested ref kind or change the web input contract.",
          ),
        );
      }
      continue;
    }

    if (binding.kind === "asset") {
      if (typeof value !== "string") {
        errors.push(
          err(
            "BAD_WEB_INPUT",
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
            "Use the requested asset type or change the web input contract.",
          ),
        );
      }
      continue;
    }

    if (typeof value === "string" && Object.prototype.hasOwnProperty.call(scene.ranges, value)) continue;
    checkSpanValue(value, path, scene, scenes, errors);
  }
}

function validateWebManifestShape(
  text: string,
  path: string,
  errors: BundleError[],
  document: WebDocument,
): WebManifest | undefined {
  try {
    return loadWebManifestFromSource(text, document);
  } catch (e) {
    if (e instanceof WebManifestError) {
      errors.push(
        err(
          e.code,
          path,
          e.message,
          'Add exactly one <script type="application/showtell+json"> manifest with schemaVersion 3, propsSchema, and inputs.',
        ),
      );
      return undefined;
    }
    errors.push(
      err(
        "INVALID_WEB_MANIFEST",
        path,
        `Invalid web manifest: ${(e as Error).message}`,
        'Add exactly one <script type="application/showtell+json"> manifest with schemaVersion 3, propsSchema, and inputs.',
      ),
    );
    return undefined;
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
          "Pass a bundle directory that contains spec.json.",
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

  const rawVersion =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>).version : undefined;
  if (typeof rawVersion === "number" && rawVersion !== 3) {
    return {
      ok: false,
      errors: [
        err(
          "UNSUPPORTED_BUNDLE_VERSION",
          "version",
          `Bundle version ${rawVersion} is not supported; Showtell accepts version 3 bundles only.`,
          rawVersion === 2
            ? 'Migrate to version 3: replace TSX with a bundle-local HTML file, set visual.kind="web", add its application/showtell+json manifest, and author one paused GSAP timeline.'
            : 'Set version to 3 and use visual.kind="web" for designed visuals or visual.kind="screencap" for recorded media.',
        ),
      ],
      warnings,
    };
  }

  const rawScenes =
    data && typeof data === "object" && !Array.isArray(data) && Array.isArray((data as Record<string, unknown>).scenes)
      ? ((data as Record<string, unknown>).scenes as unknown[])
      : [];
  const builtinSceneIndex = rawScenes.findIndex((scene) => {
    if (!scene || typeof scene !== "object" || Array.isArray(scene)) return false;
    const visual = (scene as Record<string, unknown>).visual;
    return (
      visual !== null &&
      typeof visual === "object" &&
      !Array.isArray(visual) &&
      (visual as Record<string, unknown>).kind === "builtin"
    );
  });
  if (builtinSceneIndex >= 0) {
    return {
      ok: false,
      errors: [
        err(
          "UNSUPPORTED_VISUAL_KIND",
          `scenes.${builtinSceneIndex}.visual.kind`,
          'Bundle visual kind "builtin" has been removed; browser HyperFrames are the only designed visual runtime.',
          'Set visual.kind="web" and use <st-code>, <st-diff>, or <st-chart>, or run `showtell bundle templates` for a complete browser HyperFrame. Use visual.kind="screencap" only for recorded media.',
        ),
      ],
      warnings,
    };
  }

  const parsed = BundleSpec.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        err("SCHEMA_ERROR", issuePath(issue.path), issue.message, "Fix the field to match bundle.schema.json."),
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

  if (spec.meta.presenter?.enabled) {
    const presenterImages = [
      { field: "image", src: spec.meta.presenter.image },
      ...(spec.meta.presenter.logo ? [{ field: "logo", src: spec.meta.presenter.logo }] : []),
    ];
    for (const { field, src } of presenterImages) {
      try {
        bundlePresenterImageFile(bundleDir, src);
      } catch (e) {
        const code = safeFileErrorCode(e) === "MISSING_FILE" ? "MISSING_PRESENTER_IMAGE" : "BAD_PRESENTER_IMAGE_PATH";
        errors.push(
          err(
            code,
            `meta.presenter.${field}`,
            (e as Error).message,
            code === "MISSING_PRESENTER_IMAGE"
              ? "Create the presenter image file, fix the path, or set meta.presenter.enabled to false."
              : "Presenter image paths must be bundle-relative regular files, stay inside the bundle, and fit the image size limit.",
          ),
        );
      }
    }
  }

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
    if (scene.duration !== "auto") {
      const minimumDuration = scene.narration.lines.length / spec.meta.fps;
      if (scene.duration + 1e-9 < minimumDuration) {
        errors.push(
          err(
            "BAD_EXPLICIT_DURATION",
            `scenes.${sceneIndex}.duration`,
            `Explicit duration ${scene.duration}s is too short for ${scene.narration.lines.length} narration line(s) at ${spec.meta.fps}fps.`,
            `Use at least ${minimumDuration.toFixed(3)}s, or set duration to "auto".`,
          ),
        );
      }
    }
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
          if (ref.kind === "code") resolveCodeRef(repoPath, ref);
          else resolveDiff(repoPath, { file: ref.file, ref: ref.ref, animation: "magic-move" });
        }
      } catch (e) {
        errors.push(
          err(
            "BAD_REPO_REF",
            `scenes.${sceneIndex}.refs.${id}`,
            `Could not resolve ${ref.kind} ref: ${(e as Error).message}`,
            ref.kind === "code"
              ? "Use a repo-relative file path, valid line range, and valid git ref."
              : "Use a repo-relative file path and a valid git ref/range.",
          ),
        );
      }
    });

    if (scene.visual.kind === "web") {
      try {
        let webPath: string | undefined;
        try {
          webPath = bundleWebFile(bundleDir, scene.visual.src).path;
        } catch (e) {
          const code = safeFileErrorCode(e) === "MISSING_FILE" ? "MISSING_WEB" : "BAD_WEB_PATH";
          errors.push(
            err(
              code,
              `scenes.${sceneIndex}.visual.src`,
              (e as Error).message,
              code === "MISSING_WEB"
                ? "Create the web source file under the bundle."
                : "Web source paths must be bundle-relative regular files and stay inside the bundle.",
            ),
          );
        }
        if (webPath) {
          const text = readFileSync(webPath, "utf-8");
          const document = parseWebDocument(text);
          validateWebSource(text, `scenes.${sceneIndex}.visual.src`, errors, document);
          const manifest = validateWebManifestShape(text, `scenes.${sceneIndex}.visual.src`, errors, document);
          if (manifest) validateWebInputs(scene, sceneIndex, manifest, spec.assets, spec.scenes, errors);
        }
      } catch (e) {
        errors.push(
          err(
            "BAD_WEB_PATH",
            `scenes.${sceneIndex}.visual.src`,
            `Bad web source path: ${(e as Error).message}`,
            "Web source paths must be bundle-relative and stay inside the bundle.",
          ),
        );
      }
    }
  });

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, spec, bundleDir, repoPath, warnings };
}
