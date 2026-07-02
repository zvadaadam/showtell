import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { readFileAtRef, repoRelativeFile, resolveDiff } from "./repo.ts";
import { AspectRatio, TtsConfig } from "./spec.ts";
import { parseBundleTimePointRef, parseBundleTimeSpanRef, type BundleTimeSpanValue } from "./bundle-time.ts";
import { Theme, validateThemeContrast } from "./bundle-theme.ts";
import { validateHyperframeSource } from "./hyperframe-lint.ts";
import { ID_PATTERN } from "./id.ts";
import { SafeFileError, safeExistingFileInRoot } from "./safe-files.ts";
import {
  loadHyperframeContractFromSource,
  validateJsonSchemaValue,
  type BundleHyperframeInput,
  type HyperframeContract,
} from "./hyperframe-contract.ts";

const Id = z
  .string()
  .regex(new RegExp(`^${ID_PATTERN}$`), "Use 1-64 chars: letters, digits, underscore, hyphen; start with a letter.");

const Duration = z.literal("auto");
export type { BundleTheme, BundleThemeMode, BundleThemePreset, ResolvedBundleTheme } from "./bundle-theme.ts";
export { resolveBundleTheme } from "./bundle-theme.ts";

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
    `scenes.${sceneIndex}.visual.src.propsSchema`,
  )) {
    if (issue.kind === "schema") {
      errors.push(
        err(
          "BAD_HYPERFRAME_SCHEMA",
          `scenes.${sceneIndex}.visual.src`,
          `Invalid hyperframe propsSchema at ${issue.path}: ${issue.message}`,
          "Fix the hyperframe module's literal propsSchema.",
        ),
      );
    } else {
      errors.push(
        err(
          "BAD_HYPERFRAME_PROPS",
          issue.path,
          issue.message,
          "Fix visual.props to match the hyperframe's propsSchema.",
        ),
      );
    }
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

    if (scene.visual.kind === "builtin" && scene.visual.name === "screencap") {
      warnings.push(
        err(
          "UNSUPPORTED_BUNDLE_BUILTIN",
          `scenes.${sceneIndex}.visual.name`,
          'Builtin "screencap" is not renderable in bundles yet; it renders a placeholder card.',
          "Use a simple spec.json with a screencap scene for screen recordings, or author a hyperframe visual.",
        ),
      );
    }

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
