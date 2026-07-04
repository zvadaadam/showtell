import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type {
  AspectRatio,
  BundleAsset,
  BundleError,
  BundleRepoRef,
  BundleScene,
  BundleSpec,
  ResolvedBundleTheme,
  Scene,
} from "@agent-video/core";
import {
  assertSafeOutputPath,
  bundleAssetFile,
  bundleHyperframeFile,
  effectiveBeats,
  loadHyperframeContractFromSource,
  readRepoMeta,
  resolveBundleTheme,
  resolveCodeRef,
  resolveDiff,
  validateBundle,
} from "@agent-video/core";
import {
  probeImageInfo,
  canvasTheme,
  dimsFor,
  drawCaptionOverlay,
  renderCaptionedFrame,
  renderHyperframeElementToRgba,
  renderHyperframeElementToPng,
  renderSceneToPng,
  type RenderedScene,
} from "@agent-video/compose";
import { probeDurationMs, synthesize } from "@agent-video/providers";
import {
  concatClips,
  imageAudioToClip,
  mixMusicTracks,
  normalizeVideoDuration,
  silentAudio,
  framesAudioToClip,
  type MusicMixTrack,
} from "./ffmpeg.ts";
import { resolveBundlePoint, resolveBundleRange, resolveBundleSpan } from "./bundle-time.ts";
import { executeHyperframe, hyperframeThemeFromSpec } from "./hyperframe-runtime.ts";

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
  durationMs: number;
  ttsCached: boolean;
}

export interface CompiledBundleSpan {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface CompiledBundleScene {
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
  hyperframe?: CompiledBundleHyperframe;
}

export interface CompiledBundleHyperframe {
  src: string;
  sourceSha256: string;
  propsSha256: string;
  inputs: Record<string, CompiledBundleHyperframeInput>;
}

export type CompiledBundleHyperframeInput =
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
  sourceVersion: 2;
  specSha256: string;
  bundle: { dir: string; repoPath: string };
  meta: {
    title: string;
    fps: number;
    aspectRatios: AspectRatio[];
    theme?: BundleSpec["meta"]["theme"];
    resolvedTheme: ResolvedBundleTheme;
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
}

export interface BundleVisualMoment {
  sceneIndex: number;
  lineIndex: number;
  lineCount: number;
  lineId: string;
  progress: number;
  /** Exact frame time (absolute ms) for animated renders; stills omit it. */
  timeMs?: number;
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

function asChartRows(data: unknown): Record<string, string | number>[] | undefined {
  if (!Array.isArray(data)) return undefined;
  const rows: Record<string, string | number>[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" || typeof value === "number") out[key] = value;
    }
    if (Object.keys(out).length > 0) rows.push(out);
  }
  return rows.length ? rows : undefined;
}

function hasOwnKey(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function narrationText(scene: BundleScene): string {
  return scene.narration.lines.map((line) => line.text).join(" ");
}

function repoRefToScene(ref: BundleRepoRef, narration: string): Scene {
  if (ref.kind === "code") {
    return {
      kind: "code",
      content: {
        file: ref.file,
        lineStart: ref.lineStart,
        lineEnd: ref.lineEnd,
        ref: ref.ref,
        focus: ref.focus,
        language: ref.language,
      },
      narration,
      duration: "auto",
    };
  }
  return {
    kind: "diff",
    content: { file: ref.file, ref: ref.ref, animation: "magic-move" },
    narration,
    duration: "auto",
  };
}

function builtinToScene(scene: BundleScene, runtime: BundleCompileRuntime): Scene {
  const visual = scene.visual;
  const props = visual.props;
  const title = typeof props.title === "string" ? props.title : scene.id;
  if (visual.kind === "builtin" && visual.name === "title") {
    return {
      kind: "title",
      content: {
        heading: typeof props.heading === "string" ? props.heading : title,
        subtitle: typeof props.subtitle === "string" ? props.subtitle : undefined,
      },
      narration: narrationText(scene),
      duration: "auto",
    };
  }
  if (visual.kind === "builtin" && visual.name === "talking-points") {
    const points = Array.isArray(props.points)
      ? props.points.filter((point): point is string => typeof point === "string")
      : scene.narration.lines.map((line) => line.text);
    return {
      kind: "talking-points",
      content: { heading: title, points: points.length ? points : [title] },
      narration: narrationText(scene),
      duration: "auto",
    };
  }
  if (visual.kind === "builtin" && visual.name === "chart") {
    const assetId = typeof props.asset === "string" ? props.asset : undefined;
    const data = assetId ? asChartRows(runtime.assetData.get(assetId)) : asChartRows(props.data);
    return {
      kind: "chart",
      content: {
        chartType: props.chartType === "line" || props.chartType === "pie" ? props.chartType : "bar",
        title,
        data: data ?? [{ label: "No data", value: 0 }],
      },
      narration: narrationText(scene),
      duration: "auto",
    };
  }
  if (visual.kind === "builtin" && (visual.name === "code" || visual.name === "diff")) {
    const refId = visual.ref ?? (typeof props.ref === "string" ? props.ref : undefined);
    const ref = refId ? scene.refs[refId] : undefined;
    if (!ref)
      throw new Error(`builtin ${visual.name} scene "${scene.id}" needs a visual.ref that points at scene.refs.`);
    return repoRefToScene(ref, narrationText(scene));
  }
  return {
    kind: "title",
    content: { heading: title, subtitle: "This bundle visual is not renderable yet." },
    narration: narrationText(scene),
    duration: "auto",
  };
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

function compileHyperframe(
  bundleDir: string,
  scene: BundleScene,
  sceneIndex: number,
  scenes: CompiledBundleScene[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  errors: BundleError[],
): CompiledBundleHyperframe | undefined {
  if (scene.visual.kind !== "hyperframe") return undefined;
  let source: string;
  let contract: ReturnType<typeof loadHyperframeContractFromSource>;
  try {
    source = readFileSync(bundleHyperframeFile(bundleDir, scene.visual.src).path, "utf-8");
    contract = loadHyperframeContractFromSource(source);
  } catch (e) {
    errors.push(
      compileError(
        "HYPERFRAME_COMPILE_ERROR",
        `scenes.${sceneIndex}.visual.src`,
        `Could not compile hyperframe contract: ${(e as Error).message}`,
        "Fix the hyperframe default export and literal propsSchema/inputs contract.",
      ),
    );
    return undefined;
  }
  const inputs: Record<string, CompiledBundleHyperframeInput> = {};
  const compiledScene = scenes.find((item) => item.id === scene.id);

  for (const [name, binding] of Object.entries(contract.inputs)) {
    const value = scene.visual.inputs[name];
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
    } else if (binding.kind === "asset") {
      inputs[name] = { kind: "asset", assetType: binding.assetType, target: value as string };
    } else {
      let span: CompiledBundleSpan;
      try {
        span =
          typeof value === "string" && hasOwnKey(scene.ranges, value)
            ? resolveBundleRange(scene.id, value, scenes, sceneSpecs, totalMs)
            : resolveBundleSpan(value, scene.id, scenes, sceneSpecs, totalMs);
      } catch (e) {
        errors.push(
          compileError(
            "BAD_COMPILED_TIME_RANGE",
            `scenes.${sceneIndex}.visual.inputs.${name}`,
            `Could not resolve hyperframe input range "${name}": ${(e as Error).message}`,
            "Use a forward-moving line, beat, scene, named range, or explicit { from, to } span.",
          ),
        );
        continue;
      }
      inputs[name] = {
        kind: "range",
        target: typeof value === "string" ? value : `${value.from}..${value.to}`,
        ...span,
      };
    }
  }

  return {
    src: scene.visual.src,
    sourceSha256: contract.sourceSha256,
    propsSha256: sha256(JSON.stringify(scene.visual.props)),
    inputs,
  };
}

export async function compileBundle(
  bundleDirInput: string,
  opts: { cacheDir?: string } = {},
): Promise<BundleCompileResult> {
  const validation = validateBundle(bundleDirInput);
  if (!validation.ok) throw new BundleCompileError(validation.errors, validation.warnings);

  const { spec, bundleDir, repoPath, warnings } = validation;
  const planPath = join(bundleDir, "compiled-plan.json");
  const cacheDir = opts.cacheDir ?? join(bundleDir, ".agent-video", "cache");
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

  const provider = spec.audio.tts.provider;
  const voice = spec.audio.tts.voice;
  const model = spec.audio.tts.model;
  const lineAudio = new Map<string, string>();
  const scenes: CompiledBundleScene[] = [];
  const compileErrors: BundleError[] = [];
  let cursorMs = 0;

  for (let sceneIndex = 0; sceneIndex < spec.scenes.length; sceneIndex++) {
    const scene = spec.scenes[sceneIndex]!;
    const sceneStartMs = cursorMs;
    const compiledLines: CompiledBundleLine[] = [];
    for (const line of scene.narration.lines) {
      const syn = await synthesize({ text: line.text, voice, model }, { provider, cacheDir: join(cacheDir, "tts") });
      const startMs = cursorMs;
      const endMs = startMs + syn.durationMs;
      compiledLines.push({
        id: line.id,
        text: line.text,
        startMs,
        endMs,
        durationMs: syn.durationMs,
        ttsCached: syn.cached,
      });
      lineAudio.set(lineKey(scene.id, line.id), syn.wavPath);
      cursorMs = endMs;
    }
    const narrationEndMs = cursorMs;
    cursorMs += TAIL_MS;
    const compiled: CompiledBundleScene = {
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
        compiled.refs[refId] = compileRepoRef(repoPath, ref);
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
    compiled.hyperframe = compileHyperframe(bundleDir, scene, sceneIndex, scenes, spec.scenes, totalMs, compileErrors);
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

  const plan: CompiledBundlePlan = {
    version: 1,
    sourceVersion: 2,
    specSha256: sha256(rawSpec),
    bundle: { dir: ".", repoPath: rel(bundleDir, repoPath) },
    meta: {
      title: spec.meta.title,
      fps: spec.meta.fps,
      aspectRatios: spec.meta.aspectRatios,
      theme: spec.meta.theme,
      resolvedTheme: resolveBundleTheme(spec.meta.theme),
      durationMs: totalMs,
      sceneCount: spec.scenes.length,
    },
    repo: { path: rel(bundleDir, repoPath), ...readRepoMeta(repoPath) },
    assets,
    audio: { tts: spec.audio.tts, captions: spec.audio.captions, music },
    scenes,
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
  return { spec, bundleDir, repoPath, lineAudio, assetPaths, assetData, plan, planPath, warnings };
}

export async function renderBundleScene(
  scene: BundleScene,
  compiledScene: CompiledBundleScene,
  runtime: BundleCompileResult,
  aspectRatio: AspectRatio,
  moment?: BundleVisualMoment,
): Promise<RenderedScene> {
  if (scene.visual.kind === "hyperframe") {
    const executed = await executeHyperframe({
      scene,
      compiledScene,
      runtime,
      aspectRatio,
      moment,
    });
    return renderHyperframeElementToPng(executed.element, {
      aspectRatio,
      activeCue: executed.activeCue,
      theme: hyperframeThemeFromSpec(runtime.spec),
      watermark: "agent-video.dev",
    });
  }

  return renderSceneToPng(builtinToScene(scene, runtime), {
    repoPath: runtime.repoPath,
    aspectRatio,
    watermark: "agent-video.dev",
    theme: hyperframeThemeFromSpec(runtime.spec),
  });
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

export function lineMoment(planScene: CompiledBundleScene, lineIndex: number): BundleVisualMoment {
  const line = planScene.narration.lines[lineIndex]!;
  return {
    sceneIndex: planScene.index,
    lineIndex,
    lineCount: planScene.narration.lines.length,
    lineId: line.id,
    progress: planScene.narration.lines.length === 1 ? 1 : lineIndex / (planScene.narration.lines.length - 1),
  };
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

export async function renderBundle(
  bundleDirInput: string,
  opts: { outDir?: string; aspectRatios?: AspectRatio[]; cacheDir?: string; motion?: boolean } = {},
): Promise<BundleRenderResult> {
  const motionEnabled = opts.motion !== false;
  const compiled = await compileBundle(bundleDirInput, { cacheDir: opts.cacheDir });
  const outDir = opts.outDir ? resolve(opts.outDir) : join(compiled.bundleDir, "out");
  const ratios = opts.aspectRatios ?? compiled.spec.meta.aspectRatios;
  const baseName = slug(compiled.spec.meta.title || basename(compiled.bundleDir));
  const workDir = join(outDir, ".work");
  mkdirSync(outDir, { recursive: true });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const resolvedCode: BundleRenderResult["resolvedCode"] = [];
  const reportedResolvedRefs = new Set<string>();
  const warnings = [...compiled.warnings];
  const warningKeys = new Set(warnings.map((warning) => `${warning.path}:${warning.message}`));
  const outputs: CompiledBundleOutput[] = [];
  const captionTheme = canvasTheme(hyperframeThemeFromSpec(compiled.spec));
  try {
    for (const aspectRatio of ratios) {
      const clips: string[] = [];
      const aspectTag = aspectRatio.replace(":", "x");
      const burnInCaptions =
        compiled.plan.audio.captions.mode === "burn-in" || compiled.plan.audio.captions.mode === "sidecar-and-burn-in";
      for (const scene of compiled.spec.scenes) {
        const planScene = compiled.plan.scenes.find((item) => item.id === scene.id)!;
        const tag = `s${String(planScene.index).padStart(3, "0")}-${aspectTag}`;
        let tailPng: string | undefined;
        for (let lineIndex = 0; lineIndex < planScene.narration.lines.length; lineIndex++) {
          const line = planScene.narration.lines[lineIndex]!;
          const moment = lineMoment(planScene, lineIndex);
          const rendered = await renderBundleScene(scene, planScene, compiled, aspectRatio, moment);
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
          if (scene.visual.kind === "hyperframe" && motionEnabled) {
            // Animated path: render every frame of the line so hyperframes move.
            const fps = compiled.spec.meta.fps;
            const dims = dimsFor(aspectRatio);
            const frameCount = Math.max(1, Math.round((line.durationMs / 1000) * fps));
            const theme = hyperframeThemeFromSpec(compiled.spec);
            await framesAudioToClip({
              width: dims.width,
              height: dims.height,
              fps,
              frameCount,
              durationSec: line.durationMs / 1000,
              audio: compiled.lineAudio.get(lineKey(scene.id, line.id))!,
              outPath: lineClip,
              frame: async (frameIndex) => {
                const timeMs = line.startMs + ((frameIndex + 0.5) / fps) * 1000;
                const executed = await executeHyperframe({
                  scene,
                  compiledScene: planScene,
                  runtime: compiled,
                  aspectRatio,
                  moment: { ...moment, timeMs },
                });
                const frame = await renderHyperframeElementToRgba(executed.element, {
                  aspectRatio,
                  activeCue: executed.activeCue,
                  theme,
                  watermark: "agent-video.dev",
                  motion: {
                    absoluteMs: timeMs,
                    sceneMs: timeMs - planScene.startMs,
                    lineMs: timeMs - line.startMs,
                    fps,
                  },
                  drawOverlay: burnInCaptions
                    ? (frameCtx, frameDims) => drawCaptionOverlay(frameCtx, frameDims, line.text, captionTheme)
                    : undefined,
                });
                return frame.rgba;
              },
            });
          } else {
            const visualPng = burnInCaptions ? join(workDir, `${tag}-${line.id}-caption.png`) : png;
            if (burnInCaptions) {
              writeFileSync(visualPng, await renderCaptionedFrame(rendered.png, aspectRatio, line.text, captionTheme));
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
          if (scene.visual.kind === "hyperframe" && motionEnabled) {
            // Animated tail: keep the motion clock running past the last line so
            // the scene HOLDS its true end state (no snap back to a mid-line still).
            const fps = compiled.spec.meta.fps;
            const dims = dimsFor(aspectRatio);
            const frameCount = Math.max(1, Math.round((tailMs / 1000) * fps));
            const theme = hyperframeThemeFromSpec(compiled.spec);
            const moment = lineMoment(planScene, planScene.narration.lines.length - 1);
            await framesAudioToClip({
              width: dims.width,
              height: dims.height,
              fps,
              frameCount,
              durationSec: tailMs / 1000,
              audio: tailAudio,
              outPath: tailClip,
              frame: async (frameIndex) => {
                const timeMs = lastLine.endMs + ((frameIndex + 0.5) / fps) * 1000;
                const executed = await executeHyperframe({
                  scene,
                  compiledScene: planScene,
                  runtime: compiled,
                  aspectRatio,
                  moment: { ...moment, timeMs },
                });
                const frame = await renderHyperframeElementToRgba(executed.element, {
                  aspectRatio,
                  // Narration is over: kinetic captions clear during the hold.
                  activeCue: undefined,
                  theme,
                  watermark: "agent-video.dev",
                  motion: {
                    absoluteMs: timeMs,
                    sceneMs: timeMs - planScene.startMs,
                    lineMs: timeMs - lastLine.startMs,
                    fps,
                  },
                });
                return frame.rgba;
              },
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
    rmSync(workDir, { recursive: true, force: true });
  }
}
