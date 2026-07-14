import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type {
  AspectRatio,
  BundleAsset,
  BundleError,
  BundleRepoRef,
  BundleScene,
  BundleSpec,
  BundleVisualInputValue,
  ResolvedBundleTheme,
  VisualInputDescriptor,
} from "@showtell/core";
import {
  assertSafeOutputPath,
  bundleAssetFile,
  bundleWebFile,
  bundlePresenterImageFile,
  effectiveBeats,
  loadWebManifestFromSource,
  readRepoMeta,
  resolveBundleTheme,
  resolveCodeRef,
  resolveDiff,
  validateBundle,
} from "@showtell/core";
import {
  probeImageInfo,
  dimsFor,
  loadPresenterOverlay,
  renderCaptionPng,
  renderPresenterPng,
  renderWatermarkPng,
  resolveAgentLogo,
  type LoadedPresenter,
} from "@showtell/compose";
import { probeDurationMs, synthesize } from "@showtell/providers";
import {
  concatAudio,
  concatClips,
  fitAudioToDuration,
  imageAudioToClip,
  mixMusicTracks,
  normalizeVideoDuration,
  silentAudio,
  framesAudioToClip,
  type MusicMixTrack,
} from "./ffmpeg.ts";
import { amplitudeAt, extractAmplitudeEnvelope } from "./envelope.ts";
import { resolveBundlePoint, resolveBundleRange, resolveBundleSpan } from "./bundle-time.ts";
import { createBundleFrameProducer } from "./frame-producer.ts";
import { renderScreencapClip, type ScreencapPresentationCache } from "./screencap.ts";
import type { ScreencapOverlay } from "@showtell/capture";
import { webRuntimeIdentity, type WebRuntimeIdentity } from "./web-authoring.ts";

const TAIL_MS = 600;

export class BundleCompileError extends Error {
  readonly errors: BundleError[];
  readonly warnings: BundleError[];

  constructor(errors: BundleError[], warnings: BundleError[]) {
    super(`Bundle failed validation (${errors.length} error(s)).`);
    this.errors = errors;
    this.warnings = warnings;
  }
}

export interface CompiledBundleLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  /** Scheduled visual/caption span on the compiled timeline. */
  durationMs: number;
  /** Measured source narration length before an explicit scene-duration fit. */
  audioDurationMs: number;
  ttsCached: boolean;
  /** Normalized loudness per envelope window; present when the presenter bubble is on. */
  envelope?: number[];
}

export interface CompiledBundleSpan {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface CompiledBundleSceneTiming {
  index: number;
  id: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  narration: { lines: CompiledBundleLine[] };
  beats: Record<string, CompiledBundleSpan & { lines: string[] }>;
  anchors: Record<string, { atMs: number }>;
  ranges: Record<string, CompiledBundleSpan>;
  refs: Record<string, CompiledBundleRef>;
  visual: BundleScene["visual"];
}

export interface CompiledBundleScene extends CompiledBundleSceneTiming {
  program: CompiledBundleProgram;
}

export interface CompiledBundleWeb {
  src: string;
  sourceSha256: string;
  propsSha256: string;
  manifestVersion: 3;
  runtime: WebRuntimeIdentity;
  inputs: Record<string, CompiledBundleVisualInput>;
}

/** Designed pixels are always browser-rendered; screencap is a timed media source. */
export type CompiledBundleProgram = { kind: "screencap" } | ({ kind: "web" } & CompiledBundleWeb);

export type CompiledBundleVisualInput =
  | { kind: "repo"; refKind?: "code" | "diff"; target: string }
  | { kind: "asset"; assetType?: "audio" | "data" | "image"; target: string }
  | { kind: "range"; target: string; startMs: number; endMs: number; durationMs: number };

export interface CompiledBundleRef {
  kind: BundleRepoRef["kind"];
  file: string;
  ref?: string;
  lineStart?: number;
  lineEnd?: number;
  focus?: number[];
  language?: string;
  bytes: number;
  sha256: string;
  resolvedLineStart?: number;
  resolvedLineEnd?: number;
  added?: number;
  removed?: number;
}

export interface CompiledBundleAsset {
  type: BundleAsset["type"];
  src: string;
  path: string;
  bytes: number;
  sha256: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface CompiledBundlePresenterImage {
  src: string;
  path: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
}

export interface CompiledBundlePresenter {
  image: CompiledBundlePresenterImage;
  /** Bundle-local badge logo, when the spec declares one. */
  logo?: CompiledBundlePresenterImage;
  /** Renderer-shipped mark resolved from `model` when no bundle logo is set. */
  rendererLogo?: string;
  model?: string;
  position: NonNullable<BundleSpec["meta"]["presenter"]>["position"];
  size: NonNullable<BundleSpec["meta"]["presenter"]>["size"];
}

export interface CompiledBundleMusic {
  id: string;
  asset: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  loop: boolean;
  gainDb: number;
  duckUnderNarration: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface CompiledBundleOutput {
  aspectRatio: AspectRatio;
  path: string;
  durationMs: number;
  captionsPath?: string;
  captionsBurnedIn?: boolean;
}

export interface CompiledBundlePlan {
  version: 1;
  sourceVersion: 3;
  specSha256: string;
  bundle: { dir: string; repoPath: string };
  meta: {
    title: string;
    fps: number;
    aspectRatios: AspectRatio[];
    theme?: BundleSpec["meta"]["theme"];
    resolvedTheme: ResolvedBundleTheme;
    presenter?: CompiledBundlePresenter;
    durationMs: number;
    sceneCount: number;
  };
  repo: { path: string; commit?: string; branch?: string };
  assets: Record<string, CompiledBundleAsset>;
  audio: {
    tts: BundleSpec["audio"]["tts"];
    captions: BundleSpec["audio"]["captions"];
    music: CompiledBundleMusic[];
  };
  scenes: CompiledBundleScene[];
  outputs: { videos: CompiledBundleOutput[] };
}

export interface BundleCompileRuntime {
  spec: BundleSpec;
  bundleDir: string;
  repoPath: string;
  lineAudio: Map<string, string>;
  assetPaths: Map<string, string>;
  assetData: Map<string, unknown>;
  /** Preloaded presenter bubble images; absent when the presenter is off. */
  presenter?: LoadedPresenter;
}

export interface BundleCompileResult extends BundleCompileRuntime {
  plan: CompiledBundlePlan;
  planPath: string;
  warnings: BundleError[];
}

export interface BundleRenderResult {
  plan: CompiledBundlePlan;
  planPath: string;
  outDir: string;
  outputs: CompiledBundleOutput[];
  resolvedCode: { scene: number; file: string; bytes: number; sha256: string }[];
  warnings: BundleError[];
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function rel(base: string, path: string): string {
  const r = relative(base, path).replaceAll("\\", "/");
  return r && !r.startsWith("../") && r !== ".." ? r : path;
}

function lineKey(sceneId: string, lineId: string): string {
  return `${sceneId}/${lineId}`;
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "bundle";
}

function alignMsToFrame(ms: number, fps: number): number {
  return Math.round((Math.ceil((ms * fps) / 1000 - 1e-9) * 1000) / fps);
}

function fitLineDurations(audioDurationsMs: number[], sceneDurationSec: number, fps: number): number[] {
  const totalMs = sceneDurationSec * 1000;
  const minLineMs = 1000 / fps;
  const minimumMs = minLineMs * audioDurationsMs.length;
  if (totalMs + 1e-6 < minimumMs) {
    throw new Error(
      `Explicit duration ${sceneDurationSec}s is too short for ${audioDurationsMs.length} narration line(s) at ${fps}fps; use at least ${(minimumMs / 1000).toFixed(3)}s.`,
    );
  }
  const remainingMs = totalMs - minimumMs;
  const audioTotalMs = audioDurationsMs.reduce((sum, value) => sum + value, 0);
  let assignedMs = 0;
  return audioDurationsMs.map((audioMs, index) => {
    if (index === audioDurationsMs.length - 1) return totalMs - assignedMs;
    const share = audioTotalMs > 0 ? audioMs / audioTotalMs : 1 / audioDurationsMs.length;
    const durationMs = minLineMs + remainingMs * share;
    assignedMs += durationMs;
    return durationMs;
  });
}

function readDataAsset(path: string): unknown {
  const text = readFileSync(path, "utf-8");
  if (path.endsWith(".json")) return JSON.parse(text);
  return text;
}

function writePlanJson(bundleDir: string, planPath: string, plan: CompiledBundlePlan): void {
  const safePath = assertSafeOutputPath(bundleDir, planPath);
  const tmpDir = mkdtempSync(join(dirname(safePath), ".compiled-plan-"));
  const tmpPath = join(tmpDir, basename(safePath));
  try {
    writeFileSync(tmpPath, JSON.stringify(plan, null, 2) + "\n");
    renameSync(tmpPath, safePath);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function compileRepoRef(repoPath: string, ref: BundleRepoRef): CompiledBundleRef {
  if (ref.kind === "code") {
    const resolved = resolveCodeRef(repoPath, ref);
    return {
      kind: "code",
      file: ref.file,
      ref: ref.ref,
      lineStart: ref.lineStart,
      lineEnd: ref.lineEnd,
      focus: ref.focus,
      language: resolved.language,
      resolvedLineStart: resolved.startLine,
      resolvedLineEnd: resolved.endLine,
      bytes: Buffer.byteLength(resolved.text),
      sha256: sha256(resolved.text),
    };
  }
  const resolved = resolveDiff(repoPath, { file: ref.file, ref: ref.ref, animation: "magic-move" });
  return {
    kind: "diff",
    file: ref.file,
    ref: ref.ref,
    bytes: Buffer.byteLength(resolved.rawText),
    sha256: sha256(resolved.rawText),
    language: resolved.language,
    added: resolved.added,
    removed: resolved.removed,
  };
}

function compileError(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
}

function compileVisualInputs(
  scene: BundleScene,
  sceneIndex: number,
  visualInputs: Record<string, BundleVisualInputValue>,
  contract: Record<string, VisualInputDescriptor>,
  scenes: CompiledBundleSceneTiming[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  errors: BundleError[],
): Record<string, CompiledBundleVisualInput> {
  const inputs: Record<string, CompiledBundleVisualInput> = {};
  const compiledScene = scenes.find((item) => item.id === scene.id);

  for (const [name, binding] of Object.entries(contract)) {
    const value = visualInputs[name];
    if (value === undefined) {
      if (binding.kind === "range" && binding.optional && compiledScene) {
        inputs[name] = {
          kind: "range",
          target: "scene",
          startMs: compiledScene.startMs,
          endMs: compiledScene.endMs,
          durationMs: compiledScene.durationMs,
        };
      }
      continue;
    }

    if (binding.kind === "repo") {
      inputs[name] = { kind: "repo", refKind: binding.refKind, target: value as string };
      continue;
    }
    if (binding.kind === "asset") {
      inputs[name] = { kind: "asset", assetType: binding.assetType, target: value as string };
      continue;
    }

    try {
      const span =
        typeof value === "string" && hasOwnKey(scene.ranges, value)
          ? resolveBundleRange(scene.id, value, scenes, sceneSpecs, totalMs)
          : resolveBundleSpan(value, scene.id, scenes, sceneSpecs, totalMs);
      inputs[name] = {
        kind: "range",
        target: typeof value === "string" ? value : `${value.from}..${value.to}`,
        ...span,
      };
    } catch (e) {
      errors.push(
        compileError(
          "BAD_COMPILED_TIME_RANGE",
          `scenes.${sceneIndex}.visual.inputs.${name}`,
          `Could not resolve web visual input range "${name}": ${(e as Error).message}`,
          "Use a forward-moving line, beat, scene, named range, or explicit { from, to } span.",
        ),
      );
    }
  }

  return inputs;
}

function compileWebVisual(
  bundleDir: string,
  scene: BundleScene,
  sceneIndex: number,
  scenes: CompiledBundleSceneTiming[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  errors: BundleError[],
): CompiledBundleWeb | undefined {
  if (scene.visual.kind !== "web") return undefined;
  try {
    const source = readFileSync(bundleWebFile(bundleDir, scene.visual.src).path, "utf-8");
    const manifest = loadWebManifestFromSource(source);
    return {
      src: scene.visual.src,
      sourceSha256: manifest.sourceSha256,
      propsSha256: sha256(JSON.stringify(scene.visual.props)),
      manifestVersion: 3,
      runtime: webRuntimeIdentity,
      inputs: compileVisualInputs(
        scene,
        sceneIndex,
        scene.visual.inputs,
        manifest.inputs,
        scenes,
        sceneSpecs,
        totalMs,
        errors,
      ),
    };
  } catch (e) {
    errors.push(
      compileError(
        "WEB_VISUAL_COMPILE_ERROR",
        `scenes.${sceneIndex}.visual.src`,
        `Could not compile web visual contract: ${(e as Error).message}`,
        "Fix the bundle-local HTML source and its application/showtell+json manifest.",
      ),
    );
    return undefined;
  }
}

export async function compileBundle(
  bundleDirInput: string,
  opts: { cacheDir?: string } = {},
): Promise<BundleCompileResult> {
  const validation = validateBundle(bundleDirInput);
  if (!validation.ok) throw new BundleCompileError(validation.errors, validation.warnings);

  const { spec, bundleDir, repoPath, warnings } = validation;
  const planPath = join(bundleDir, "compiled-plan.json");
  const cacheDir = opts.cacheDir ?? join(bundleDir, ".showtell", "cache");
  const rawSpec = readFileSync(join(bundleDir, "spec.json"));

  const assetPaths = new Map<string, string>();
  const assetData = new Map<string, unknown>();
  const assets: Record<string, CompiledBundleAsset> = {};
  for (const [id, asset] of Object.entries(spec.assets)) {
    try {
      const safeAsset = bundleAssetFile(bundleDir, asset);
      const assetPath = safeAsset.path;
      const bytes = readFileSync(assetPath);
      assetPaths.set(id, assetPath);
      if (asset.type === "data") assetData.set(id, readDataAsset(assetPath));
      const imageInfo = asset.type === "image" ? await probeImageInfo(assetPath) : undefined;
      assets[id] = {
        type: asset.type,
        src: asset.src,
        path: rel(bundleDir, assetPath),
        bytes: safeAsset.bytes,
        sha256: sha256(bytes),
        durationMs: asset.type === "audio" ? probeDurationMs(assetPath) : undefined,
        width: imageInfo?.width,
        height: imageInfo?.height,
      };
    } catch (e) {
      throw new BundleCompileError(
        [
          compileError(
            "BAD_ASSET",
            `assets.${id}.src`,
            `Could not compile ${asset.type} asset "${id}": ${(e as Error).message}`,
            "Use a valid file for the declared asset type, or remove the asset from spec.json.",
          ),
        ],
        warnings,
      );
    }
  }

  let presenter: CompiledBundlePresenter | undefined;
  let loadedPresenter: LoadedPresenter | undefined;
  if (spec.meta.presenter?.enabled) {
    const presenterSpec = spec.meta.presenter;
    const compilePresenterImage = async (field: string, src: string): Promise<CompiledBundlePresenterImage> => {
      try {
        const safe = bundlePresenterImageFile(bundleDir, src);
        const info = await probeImageInfo(safe.path);
        return {
          src,
          path: rel(bundleDir, safe.path),
          bytes: safe.bytes,
          sha256: sha256(readFileSync(safe.path)),
          width: info?.width,
          height: info?.height,
        };
      } catch (e) {
        throw new BundleCompileError(
          [
            compileError(
              "BAD_PRESENTER_IMAGE",
              `meta.presenter.${field}`,
              `Could not compile presenter ${field}: ${(e as Error).message}`,
              "Use a bundle-relative image file, or set meta.presenter.enabled to false.",
            ),
          ],
          warnings,
        );
      }
    };
    presenter = {
      image: await compilePresenterImage("image", presenterSpec.image),
      logo: presenterSpec.logo ? await compilePresenterImage("logo", presenterSpec.logo) : undefined,
      rendererLogo: presenterSpec.logo ? undefined : resolveAgentLogo(presenterSpec.model)?.id,
      model: presenterSpec.model,
      position: presenterSpec.position,
      size: presenterSpec.size,
    };
    loadedPresenter = await loadPresenterOverlay({
      imagePath: resolve(bundleDir, presenter.image.path),
      logoPath: presenter.logo ? resolve(bundleDir, presenter.logo.path) : undefined,
      model: presenterSpec.model,
      position: presenterSpec.position,
      size: presenterSpec.size,
    });
  }

  const provider = spec.audio.tts.provider;
  const voice = spec.audio.tts.voice;
  const model = spec.audio.tts.model;
  const lineAudio = new Map<string, string>();
  const scenes: CompiledBundleSceneTiming[] = [];
  const compileErrors: BundleError[] = [];
  let cursorMs = 0;

  for (let sceneIndex = 0; sceneIndex < spec.scenes.length; sceneIndex++) {
    const scene = spec.scenes[sceneIndex]!;
    const sceneStartMs = cursorMs;
    const compiledLines: CompiledBundleLine[] = [];
    const synthesized = [];
    for (const line of scene.narration.lines) {
      const syn = await synthesize({ text: line.text, voice, model }, { provider, cacheDir: join(cacheDir, "tts") });
      synthesized.push({ line, syn });
      lineAudio.set(lineKey(scene.id, line.id), syn.wavPath);
    }
    let scheduledDurations: number[];
    try {
      scheduledDurations =
        scene.duration === "auto"
          ? synthesized.map(({ syn }) => syn.durationMs)
          : fitLineDurations(
              synthesized.map(({ syn }) => syn.durationMs),
              scene.duration,
              spec.meta.fps,
            );
    } catch (error) {
      compileErrors.push(
        compileError(
          "BAD_EXPLICIT_DURATION",
          `scenes.${sceneIndex}.duration`,
          (error as Error).message,
          'Increase the duration or set it to "auto" so measured narration controls the scene clock.',
        ),
      );
      scheduledDurations = synthesized.map(({ syn }) => syn.durationMs);
    }
    for (let lineIndex = 0; lineIndex < synthesized.length; lineIndex++) {
      const { line, syn } = synthesized[lineIndex]!;
      const durationMs = scheduledDurations[lineIndex]!;
      const startMs = cursorMs;
      const endMs = startMs + durationMs;
      compiledLines.push({
        id: line.id,
        text: line.text,
        startMs,
        endMs,
        durationMs,
        audioDurationMs: syn.durationMs,
        ttsCached: syn.cached,
        envelope: loadedPresenter ? extractAmplitudeEnvelope(syn.wavPath) : undefined,
      });
      cursorMs = endMs;
    }
    const narrationEndMs = cursorMs;
    if (scene.duration === "auto") cursorMs += TAIL_MS;
    const compiled: CompiledBundleSceneTiming = {
      index: sceneIndex,
      id: scene.id,
      startMs: sceneStartMs,
      endMs: cursorMs,
      durationMs: cursorMs - sceneStartMs,
      narration: { lines: compiledLines },
      beats: {},
      anchors: {},
      ranges: {},
      refs: {},
      visual: scene.visual,
    };
    for (const beat of effectiveBeats(scene)) {
      const beatLines = beat.lines.map((id) => compiledLines.find((line) => line.id === id)!);
      const startMs = beatLines[0]?.startMs ?? sceneStartMs;
      const endMs = beatLines[beatLines.length - 1]?.endMs ?? narrationEndMs;
      compiled.beats[beat.id] = { lines: beat.lines, startMs, endMs, durationMs: endMs - startMs };
    }
    for (const [refId, ref] of Object.entries(scene.refs)) {
      try {
        const compiledRef = compileRepoRef(repoPath, ref);
        compiled.refs[refId] = compiledRef;
        if (compiledRef.kind === "diff" && compiledRef.added === 0 && compiledRef.removed === 0) {
          warnings.push(
            compileError(
              "EMPTY_DIFF",
              `scenes.${sceneIndex}.refs.${refId}`,
              `Diff ref "${refId}" for ${compiledRef.file} is EMPTY and resolves to no changes (+0 −0).`,
              'If the file changed in the base commit, widen the git range; note that "A..B" excludes commit A.',
            ),
          );
        }
      } catch (e) {
        compileErrors.push(
          compileError(
            "BAD_REPO_REF",
            `scenes.${sceneIndex}.refs.${refId}`,
            `Could not compile repo ref "${refId}": ${(e as Error).message}`,
            "Use a valid repo-relative file, line range, and git ref/range for this scene ref.",
          ),
        );
      }
    }
    scenes.push(compiled);
  }

  const totalMs = alignMsToFrame(cursorMs, spec.meta.fps);
  if (totalMs > cursorMs && scenes.length > 0) {
    const lastScene = scenes[scenes.length - 1]!;
    lastScene.endMs = totalMs;
    lastScene.durationMs += totalMs - cursorMs;
  }
  const programs: Array<CompiledBundleProgram | undefined> = [];
  for (let sceneIndex = 0; sceneIndex < spec.scenes.length; sceneIndex++) {
    const scene = spec.scenes[sceneIndex]!;
    const compiled = scenes.find((item) => item.id === scene.id)!;
    for (let anchorIndex = 0; anchorIndex < scene.anchors.length; anchorIndex++) {
      const anchor = scene.anchors[anchorIndex]!;
      try {
        compiled.anchors[anchor.id] = {
          atMs: resolveBundlePoint(anchor.at, scene.id, scenes, spec.scenes, totalMs),
        };
      } catch (e) {
        compileErrors.push(
          compileError(
            "BAD_COMPILED_TIME_REF",
            `scenes.${sceneIndex}.anchors.${anchorIndex}.at`,
            `Could not resolve anchor "${anchor.id}": ${(e as Error).message}`,
            "Point this anchor at an existing forward-resolvable scene, line, beat, range, or anchor.",
          ),
        );
      }
    }
    for (const rangeId of Object.keys(scene.ranges)) {
      try {
        resolveBundleRange(scene.id, rangeId, scenes, spec.scenes, totalMs);
      } catch (e) {
        compileErrors.push(
          compileError(
            "BAD_COMPILED_TIME_RANGE",
            `scenes.${sceneIndex}.ranges.${rangeId}`,
            `Could not resolve range "${rangeId}": ${(e as Error).message}`,
            "Use a forward-moving line, beat, scene, named range, or explicit { from, to } span.",
          ),
        );
      }
    }
    if (scene.visual.kind === "screencap") {
      programs[sceneIndex] = { kind: "screencap" };
    } else {
      const program = compileWebVisual(bundleDir, scene, sceneIndex, scenes, spec.scenes, totalMs, compileErrors);
      if (program) programs[sceneIndex] = { kind: "web", ...program };
    }
  }

  const music: CompiledBundleMusic[] = [];
  spec.audio.music.forEach((track, trackIndex) => {
    let span: CompiledBundleSpan;
    try {
      span = resolveBundleSpan(track.range, spec.scenes[0]!.id, scenes, spec.scenes, totalMs);
    } catch (e) {
      compileErrors.push(
        compileError(
          "BAD_COMPILED_TIME_RANGE",
          `audio.music.${trackIndex}.range`,
          `Could not resolve music range "${track.id}": ${(e as Error).message}`,
          "Use a forward-moving line, beat, scene, named range, or explicit { from, to } span.",
        ),
      );
      return;
    }
    music.push({
      id: track.id,
      asset: track.asset,
      startMs: span.startMs,
      endMs: span.endMs,
      durationMs: span.durationMs,
      loop: track.loop,
      gainDb: track.gainDb,
      duckUnderNarration: track.duckUnderNarration,
      fadeInMs: track.fadeInMs,
      fadeOutMs: track.fadeOutMs,
    });
  });

  if (compileErrors.length > 0) throw new BundleCompileError(compileErrors, warnings);

  const compiledScenes: CompiledBundleScene[] = scenes.map((scene, index) => {
    const program = programs[index];
    if (!program) throw new Error(`Internal error: scene "${scene.id}" has no compiled render program.`);
    return { ...scene, program };
  });

  const plan: CompiledBundlePlan = {
    version: 1,
    sourceVersion: 3,
    specSha256: sha256(rawSpec),
    bundle: { dir: ".", repoPath: rel(bundleDir, repoPath) },
    meta: {
      title: spec.meta.title,
      fps: spec.meta.fps,
      aspectRatios: spec.meta.aspectRatios,
      theme: spec.meta.theme,
      resolvedTheme: resolveBundleTheme(spec.meta.theme),
      presenter,
      durationMs: totalMs,
      sceneCount: spec.scenes.length,
    },
    repo: { path: rel(bundleDir, repoPath), ...readRepoMeta(repoPath) },
    assets,
    audio: { tts: spec.audio.tts, captions: spec.audio.captions, music },
    scenes: compiledScenes,
    outputs: { videos: [] },
  };

  try {
    writePlanJson(bundleDir, planPath, plan);
  } catch (e) {
    throw new BundleCompileError(
      [
        compileError(
          "BAD_PLAN_PATH",
          "compiled-plan.json",
          `Could not write compiled plan: ${(e as Error).message}`,
          "Remove symlinks or non-file outputs; compiled-plan.json must be a regular file inside the bundle.",
        ),
      ],
      warnings,
    );
  }
  return {
    spec,
    bundleDir,
    repoPath,
    lineAudio,
    assetPaths,
    assetData,
    presenter: loadedPresenter,
    plan,
    planPath,
    warnings,
  };
}

function srtStamp(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = Math.floor(ms % 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rest).padStart(3, "0")}`;
}

function writeSrt(path: string, plan: CompiledBundlePlan): void {
  let idx = 1;
  const blocks: string[] = [];
  for (const scene of plan.scenes) {
    for (const line of scene.narration.lines) {
      blocks.push(`${idx}\n${srtStamp(line.startMs)} --> ${srtStamp(line.endMs)}\n${line.text}\n`);
      idx++;
    }
  }
  writeFileSync(path, blocks.join("\n"));
}

function musicMixTracks(compiled: BundleCompileResult): MusicMixTrack[] {
  return compiled.plan.audio.music.map((track) => {
    const file = compiled.assetPaths.get(track.asset);
    if (!file) throw new Error(`Music asset "${track.asset}" was not compiled.`);
    return {
      file,
      startSec: track.startMs / 1000,
      durationSec: track.durationMs / 1000,
      gainDb: track.gainDb,
      loop: track.loop,
      duckUnderNarration: track.duckUnderNarration,
      fadeInSec: track.fadeInMs / 1000,
      fadeOutSec: track.fadeOutMs / 1000,
    };
  });
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function activeLineIndexAtTime(planScene: CompiledBundleScene, timeMs: number): number {
  const lines = planScene.narration.lines;
  if (lines.length <= 1) return 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (timeMs >= line.startMs && timeMs < line.endMs) return i;
  }
  if (timeMs < lines[0]!.startMs) return 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (timeMs >= lines[i]!.startMs) return i;
  }
  return 0;
}

export interface ExactBundleFrame {
  timeMs: number;
  frame: number;
  lineIndex: number;
  lineId: string;
  lineActive: boolean;
  sceneProgress: number;
  lineMs: number;
}

export interface BundleFrameSample {
  timeMs: number;
  preferredLineIndex?: number;
  lineActive?: boolean;
}

export function exactBundleFrameAt(
  planScene: CompiledBundleScene,
  sample: number | BundleFrameSample,
  fps: number,
): ExactBundleFrame {
  const atMs = typeof sample === "number" ? sample : sample.timeMs;
  const preferredLineIndex = typeof sample === "number" ? undefined : sample.preferredLineIndex;
  const lineIndex =
    preferredLineIndex !== undefined
      ? Math.max(0, Math.min(planScene.narration.lines.length - 1, preferredLineIndex))
      : activeLineIndexAtTime(planScene, atMs);
  const line = planScene.narration.lines[lineIndex]!;
  const lineActive =
    typeof sample === "number" || sample.lineActive === undefined
      ? preferredLineIndex !== undefined
        ? true
        : atMs >= line.startMs && atMs < line.endMs
      : sample.lineActive;
  const sceneProgress = planScene.durationMs > 0 ? clamp01((atMs - planScene.startMs) / planScene.durationMs) : 1;
  const lineMs = atMs - line.startMs;
  const frame = Math.round((atMs * fps) / 1000);
  return {
    timeMs: atMs,
    frame,
    lineIndex,
    lineId: line.id,
    lineActive,
    sceneProgress,
    lineMs,
  };
}

export function lineSampleTimeMs(line: CompiledBundleLine, fraction: number, fps: number): number {
  const frameCount = Math.max(1, Math.round((line.durationMs / 1000) * fps));
  const frameIndex = frameCount === 1 ? 0 : Math.round(clamp01(fraction) * (frameCount - 1));
  return line.startMs + ((frameIndex + 0.5) / fps) * 1000;
}

export function lineSampleFractions(samplesPerLine: number): number[] {
  if (samplesPerLine < 2 || !Number.isInteger(samplesPerLine)) {
    throw new Error("samplesPerLine must be an integer >= 2.");
  }
  return Array.from({ length: samplesPerLine }, (_unused, index) => index / (samplesPerLine - 1));
}

export function addUniqueWarning(list: BundleError[], seenKeys: Set<string>, warning: BundleError): void {
  const key = `${warning.path}:${warning.message}`;
  if (!seenKeys.has(key)) {
    list.push(warning);
    seenKeys.add(key);
  }
}

function renderWarning(sceneIndex: number, lineIndex: number, message: string): BundleError {
  return {
    code: "RENDER_WARNING",
    path: `scenes.${sceneIndex}.narration.lines.${lineIndex}`,
    message,
    hint: "Inspect the visual inputs for this line; the renderer produced a fallback or warning state.",
  };
}

function screencapNarrationAudio(
  compiled: BundleCompileResult,
  scene: BundleScene,
  planScene: CompiledBundleScene,
  workDir: string,
): string {
  const sceneTag = `s${String(planScene.index).padStart(3, "0")}`;
  const output = join(workDir, `${sceneTag}-narration.wav`);
  if (existsSync(output)) return output;

  // Lay each line onto the compiled schedule: explicit scene durations stretch
  // or compress line spans (fitLineDurations), and SRT/beat/range consumers all
  // read those spans, so the audible bed must follow the same grid.
  const parts: string[] = [];
  let cursorMs = planScene.startMs;
  for (const line of planScene.narration.lines) {
    const audio = compiled.lineAudio.get(lineKey(scene.id, line.id));
    if (!audio) throw new Error(`Narration audio is missing for ${scene.id}/${line.id}.`);
    const gapMs = line.startMs - cursorMs;
    if (gapMs > 1) {
      const gap = join(workDir, `${sceneTag}-gap-${line.id}.wav`);
      silentAudio(gap, gapMs / 1000);
      parts.push(gap);
    }
    if (Math.abs(line.durationMs - line.audioDurationMs) <= 1) {
      parts.push(audio);
    } else {
      const fitted = join(workDir, `${sceneTag}-line-${line.id}.wav`);
      fitAudioToDuration(audio, fitted, line.durationMs / 1000);
      parts.push(fitted);
    }
    cursorMs = line.endMs;
  }
  const tailMs = Math.max(0, planScene.endMs - cursorMs);
  if (tailMs > 1) {
    const tail = join(workDir, `${sceneTag}-tail.wav`);
    silentAudio(tail, tailMs / 1000);
    parts.push(tail);
  }
  concatAudio(parts, output);
  return output;
}

export async function renderBundle(
  bundleDirInput: string,
  opts: {
    outDir?: string;
    aspectRatios?: AspectRatio[];
    cacheDir?: string;
    motion?: boolean;
    baseName?: string;
    watermark?: string | false;
  } = {},
): Promise<BundleRenderResult> {
  const motionEnabled = opts.motion !== false;
  const compiled = await compileBundle(bundleDirInput, { cacheDir: opts.cacheDir });
  const outDir = opts.outDir ? resolve(opts.outDir) : join(compiled.bundleDir, "out");
  const ratios = opts.aspectRatios ?? compiled.spec.meta.aspectRatios;
  const baseName = opts.baseName ?? slug(compiled.spec.meta.title || basename(compiled.bundleDir));
  const watermark = opts.watermark ?? "showtell";
  const workDir = join(outDir, ".work");
  mkdirSync(outDir, { recursive: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const resolvedCode: BundleRenderResult["resolvedCode"] = [];
  const reportedResolvedRefs = new Set<string>();
  const warnings = [...compiled.warnings];
  const warningKeys = new Set(warnings.map((warning) => `${warning.path}:${warning.message}`));
  const outputs: CompiledBundleOutput[] = [];
  const frameProducer = createBundleFrameProducer(compiled);
  const screencaps: ScreencapPresentationCache = new Map();
  try {
    for (const aspectRatio of ratios) {
      const clips: string[] = [];
      const aspectTag = aspectRatio.replace(":", "x");
      const dimensions = dimsFor(aspectRatio);
      let watermarkPng: string | undefined;
      if (watermark !== false) {
        watermarkPng = join(workDir, `watermark-${aspectTag}.png`);
        writeFileSync(watermarkPng, renderWatermarkPng(aspectRatio, watermark));
      }
      let presenterPng: string | undefined;
      if (compiled.presenter) {
        presenterPng = join(workDir, `presenter-${aspectTag}.png`);
        writeFileSync(
          presenterPng,
          renderPresenterPng(aspectRatio, compiled.plan.meta.resolvedTheme, { ...compiled.presenter, amplitude: 0 }),
        );
      }
      const burnInCaptions =
        compiled.plan.audio.captions.mode === "burn-in" || compiled.plan.audio.captions.mode === "sidecar-and-burn-in";
      for (const scene of compiled.spec.scenes) {
        const planScene = compiled.plan.scenes.find((item) => item.id === scene.id)!;
        const tag = `s${String(planScene.index).padStart(3, "0")}-${aspectTag}`;
        if (scene.visual.kind === "screencap") {
          const clip = join(workDir, `${tag}-screencap.mp4`);
          // Same chrome order as renderFrameChrome: watermark, presenter, caption.
          const overlays: ScreencapOverlay[] = [];
          if (watermarkPng) overlays.push({ png: watermarkPng });
          if (presenterPng) overlays.push({ png: presenterPng });
          if (burnInCaptions) {
            for (const line of planScene.narration.lines) {
              if (!line.text.trim()) continue;
              const captionPng = join(workDir, `${tag}-caption-${line.id}.png`);
              writeFileSync(captionPng, renderCaptionPng(aspectRatio, line.text, compiled.plan.meta.resolvedTheme));
              overlays.push({
                png: captionPng,
                enableStartSec: (line.startMs - planScene.startMs) / 1000,
                enableEndSec: (line.endMs - planScene.startMs) / 1000,
              });
            }
          }
          const screencapWarnings = renderScreencapClip(screencaps, {
            sceneIndex: planScene.index,
            capture: scene.visual,
            repoPath: compiled.repoPath,
            outPath: clip,
            width: dimensions.width,
            height: dimensions.height,
            durationSec: planScene.durationMs / 1000,
            fps: compiled.spec.meta.fps,
            audio: screencapNarrationAudio(compiled, scene, planScene, workDir),
            overlays: overlays.length > 0 ? overlays : undefined,
          });
          for (const message of screencapWarnings) {
            addUniqueWarning(warnings, warningKeys, {
              code: "SCREENCAP_WARNING",
              path: `scenes.${planScene.index}.visual`,
              message,
              hint: "Inspect the capture session, clip range, and playback sidecar for this screencap scene.",
            });
          }
          clips.push(clip);
          continue;
        }
        let tailPng: string | undefined;
        for (let lineIndex = 0; lineIndex < planScene.narration.lines.length; lineIndex++) {
          const line = planScene.narration.lines[lineIndex]!;
          const heldExact = exactBundleFrameAt(
            planScene,
            { timeMs: lineSampleTimeMs(line, 0.5, compiled.spec.meta.fps), preferredLineIndex: lineIndex },
            compiled.spec.meta.fps,
          );
          const rendered = await frameProducer.render({
            scene,
            compiledScene: planScene,
            aspectRatio,
            exact: heldExact,
            presentation: { watermark, presenterAmplitude: 0 },
          });
          if (aspectRatio === ratios[0]) {
            for (const resolved of rendered.resolvedRefs) {
              const refSha = sha256(resolved.text);
              const refKey = `${planScene.index}:${resolved.file}:${refSha}`;
              if (!reportedResolvedRefs.has(refKey)) {
                resolvedCode.push({
                  scene: planScene.index,
                  file: resolved.file,
                  bytes: Buffer.byteLength(resolved.text),
                  sha256: refSha,
                });
                reportedResolvedRefs.add(refKey);
              }
            }
          }
          if (aspectRatio === ratios[0] && rendered.warning) {
            const warning = renderWarning(planScene.index, lineIndex, rendered.warning);
            addUniqueWarning(warnings, warningKeys, warning);
          }

          const png = join(workDir, `${tag}-${line.id}.png`);
          writeFileSync(png, rendered.png);
          tailPng = png;
          if (aspectRatio === ratios[0] && lineIndex === 0) {
            writeFileSync(join(outDir, `thumb-${String(planScene.index).padStart(3, "0")}.png`), rendered.png);
          }

          const lineClip = join(workDir, `${tag}-${line.id}.mp4`);
          if (planScene.program.kind === "web" && motionEnabled) {
            // Animated path: render every frame of browser-authored visuals.
            const fps = compiled.spec.meta.fps;
            const dims = dimsFor(aspectRatio);
            const frameCount = Math.max(1, Math.round((line.durationMs / 1000) * fps));
            const frameAt = async (frameIndex: number) => {
              const timeMs = line.startMs + ((frameIndex + 0.5) / fps) * 1000;
              const exact = exactBundleFrameAt(planScene, { timeMs, preferredLineIndex: lineIndex }, fps);
              return frameProducer.render({
                scene,
                compiledScene: planScene,
                aspectRatio,
                exact,
                presentation: {
                  watermark,
                  presenterAmplitude: amplitudeAt(line.envelope, exact.lineMs),
                  caption: burnInCaptions ? line.text : undefined,
                },
              });
            };
            const common = {
              fps,
              frameCount,
              durationSec: line.durationMs / 1000,
              audio: compiled.lineAudio.get(lineKey(scene.id, line.id))!,
              outPath: lineClip,
            };
            await framesAudioToClip({
              ...common,
              width: dims.width,
              height: dims.height,
              frame: async (frameIndex) => (await frameAt(frameIndex)).rgba,
            });
          } else {
            const visualPng = burnInCaptions ? join(workDir, `${tag}-${line.id}-caption.png`) : png;
            if (burnInCaptions) {
              const captioned = await frameProducer.render({
                scene,
                compiledScene: planScene,
                aspectRatio,
                exact: heldExact,
                presentation: { watermark, presenterAmplitude: 0, caption: line.text },
              });
              writeFileSync(visualPng, captioned.png);
            }
            imageAudioToClip({
              image: visualPng,
              audio: compiled.lineAudio.get(lineKey(scene.id, line.id))!,
              durationSec: line.durationMs / 1000,
              fps: compiled.spec.meta.fps,
              outPath: lineClip,
            });
          }
          clips.push(lineClip);
        }

        const lastLine = planScene.narration.lines[planScene.narration.lines.length - 1]!;
        const tailMs = Math.max(0, planScene.endMs - lastLine.endMs);
        if (tailMs > 0) {
          const tailAudio = join(workDir, `${tag}-tail.wav`);
          const tailClip = join(workDir, `${tag}-tail.mp4`);
          silentAudio(tailAudio, tailMs / 1000);
          if (planScene.program.kind === "web" && motionEnabled) {
            // Animated tail: keep the motion clock running past the last line so
            // the scene HOLDS its true end state (no snap back to a mid-line still).
            const fps = compiled.spec.meta.fps;
            const dims = dimsFor(aspectRatio);
            const frameCount = Math.max(1, Math.round((tailMs / 1000) * fps));
            const frameAt = async (frameIndex: number) => {
              const timeMs = lastLine.endMs + ((frameIndex + 0.5) / fps) * 1000;
              const exact = exactBundleFrameAt(
                planScene,
                {
                  timeMs,
                  preferredLineIndex: planScene.narration.lines.length - 1,
                  lineActive: false,
                },
                fps,
              );
              return frameProducer.render({
                scene,
                compiledScene: planScene,
                aspectRatio,
                exact,
                presentation: { watermark, presenterAmplitude: 0 },
              });
            };
            const common = {
              fps,
              frameCount,
              durationSec: tailMs / 1000,
              audio: tailAudio,
              outPath: tailClip,
            };
            await framesAudioToClip({
              ...common,
              width: dims.width,
              height: dims.height,
              frame: async (frameIndex) => (await frameAt(frameIndex)).rgba,
            });
            clips.push(tailClip);
          } else if (tailPng) {
            imageAudioToClip({
              image: tailPng,
              audio: tailAudio,
              durationSec: tailMs / 1000,
              fps: compiled.spec.meta.fps,
              outPath: tailClip,
            });
            clips.push(tailClip);
          }
        }
      }

      const narrationVideo = join(workDir, `${baseName}-${aspectTag}-narration.mp4`);
      if (clips.length === 1) copyFileSync(clips[0]!, narrationVideo);
      else concatClips(clips, narrationVideo, workDir);

      const finalVideo = join(outDir, `${baseName}-${aspectTag}.mp4`);
      const muxedVideo = join(workDir, `${baseName}-${aspectTag}-muxed.mp4`);
      if (compiled.plan.audio.music.length > 0) {
        mixMusicTracks(narrationVideo, musicMixTracks(compiled), muxedVideo, workDir);
      } else {
        copyFileSync(narrationVideo, muxedVideo);
      }
      normalizeVideoDuration(muxedVideo, finalVideo, compiled.plan.meta.durationMs / 1000, compiled.spec.meta.fps);

      let captionsPath: string | undefined;
      let captionsBurnedIn = false;
      if (compiled.plan.audio.captions.mode !== "off") {
        captionsPath = join(outDir, `${baseName}-${aspectTag}.srt`);
        writeSrt(captionsPath, compiled.plan);
        captionsBurnedIn = burnInCaptions;
      }
      outputs.push({
        aspectRatio,
        path: finalVideo,
        durationMs: probeDurationMs(finalVideo),
        captionsPath,
        captionsBurnedIn,
      });
    }

    compiled.plan.outputs.videos = outputs.map((output) => ({
      ...output,
      path: rel(compiled.bundleDir, output.path),
      captionsPath: output.captionsPath ? rel(compiled.bundleDir, output.captionsPath) : undefined,
    }));
    writePlanJson(compiled.bundleDir, compiled.planPath, compiled.plan);
    return {
      plan: compiled.plan,
      planPath: compiled.planPath,
      outDir,
      outputs,
      resolvedCode,
      warnings,
    };
  } finally {
    await frameProducer.close();
    rmSync(workDir, { recursive: true, force: true });
  }
}
