/** Execute a validated local hyperframe module with renderer-owned data. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dimsFor } from "@agent-video/compose";
import {
  bundleHyperframeFile,
  loadHyperframeContractFromSource,
  resolveCodeRef,
  resolveDiff,
  resolveBundleTheme,
  type AspectRatio,
  type BundleScene,
} from "@agent-video/core";
import type {
  CaptionCue,
  HyperframeContext,
  HyperframeTheme,
  HyperframeElement,
  HyperframeModule,
  ResolvedAsset,
  ResolvedCode,
  ResolvedDiff,
  ResolvedRange,
} from "@agent-video/hyperframes";
import type { BundleCompileResult, BundleVisualMoment, CompiledBundleLine, CompiledBundleScene } from "./bundle.ts";

interface ExecuteHyperframeOpts {
  scene: BundleScene;
  compiledScene: CompiledBundleScene;
  runtime: BundleCompileResult;
  aspectRatio: AspectRatio;
  moment?: BundleVisualMoment;
}

export interface ExecutedHyperframe {
  element: HyperframeElement;
  activeCue?: CaptionCue;
}

type RuntimeModule = HyperframeModule<Record<string, unknown>>;

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function deterministicRandom(seed: string): number {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return parseInt(hash, 16) / 0xffffffffffff;
}

export function hyperframeThemeFromSpec(spec: BundleCompileResult["spec"]): HyperframeTheme {
  return resolveBundleTheme(spec.meta.theme);
}

function hyperframesSdkUrl(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(resolve(here, "../../hyperframes/src/index.ts")).href;
}

function runtimeImportSource(source: string): string {
  return source.replaceAll(/from\s+["']@agent-video\/hyperframes["']/g, `from "${hyperframesSdkUrl()}"`);
}

function activeLine(compiledScene: CompiledBundleScene, moment?: BundleVisualMoment): CompiledBundleLine | undefined {
  if (moment) return compiledScene.narration.lines[moment.lineIndex];
  return compiledScene.narration.lines[0];
}

function activeCue(compiledScene: CompiledBundleScene, moment?: BundleVisualMoment): CaptionCue | undefined {
  const line = activeLine(compiledScene, moment);
  if (!line) return undefined;
  return {
    sceneId: compiledScene.id,
    lineId: line.id,
    text: line.text,
    startMs: line.startMs,
    endMs: line.endMs,
  };
}

function sampleTimeMs(compiledScene: CompiledBundleScene, moment?: BundleVisualMoment): number {
  const line = activeLine(compiledScene, moment);
  if (line) return line.startMs + line.durationMs / 2;
  return compiledScene.startMs + compiledScene.durationMs * (moment?.progress ?? 0);
}

function rangeFromSpan(span: { startMs: number; endMs: number; durationMs: number }, atMs: number): ResolvedRange {
  const progress = span.durationMs > 0 ? Math.max(0, Math.min(1, (atMs - span.startMs) / span.durationMs)) : 1;
  return {
    active: atMs >= span.startMs && atMs <= span.endMs,
    progress,
    startMs: span.startMs,
    endMs: span.endMs,
    durationMs: span.durationMs,
  };
}

async function loadHyperframeModule(bundleDir: string, scene: BundleScene): Promise<RuntimeModule> {
  if (scene.visual.kind !== "hyperframe") throw new Error("Scene visual is not a hyperframe.");
  const hyperframePath = bundleHyperframeFile(bundleDir, scene.visual.src).path;
  const source = readFileSync(hyperframePath, "utf-8");
  loadHyperframeContractFromSource(source);
  const sourceHash = sha256(source);
  const runtimeDir = join(bundleDir, ".agent-video", "hyperframe-runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const runtimePath = join(runtimeDir, `${sourceHash}.tsx`);
  writeFileSync(runtimePath, runtimeImportSource(source));
  const url = `${pathToFileURL(runtimePath).href}?sha=${sourceHash}`;
  const loaded = (await import(url)) as { default?: RuntimeModule };
  if (!loaded.default || typeof loaded.default.render !== "function") {
    throw new Error(`Hyperframe ${scene.visual.src} must default-export a render(ctx) function.`);
  }
  return loaded.default;
}

function buildRepoResolver(opts: ExecuteHyperframeOpts): HyperframeContext<Record<string, unknown>>["repo"] {
  return (inputName: string): ResolvedCode | ResolvedDiff => {
    const input = opts.compiledScene.hyperframe?.inputs[inputName];
    if (!input || input.kind !== "repo") throw new Error(`Unknown repo hyperframe input "${inputName}".`);
    const ref = opts.scene.refs[input.target];
    if (!ref) throw new Error(`Hyperframe input "${inputName}" points at missing repo ref "${input.target}".`);
    if (ref.kind === "code") {
      const resolved = resolveCodeRef(opts.runtime.repoPath, ref);
      return {
        kind: "code",
        id: input.target,
        file: ref.file,
        ref: ref.ref,
        lineStart: resolved.startLine,
        lineEnd: resolved.endLine,
        focus: ref.focus,
        language: resolved.language,
        text: resolved.text,
        sha256: sha256(resolved.text),
      };
    }
    const resolved = resolveDiff(opts.runtime.repoPath, { file: ref.file, ref: ref.ref, animation: "magic-move" });
    return {
      kind: "diff",
      id: input.target,
      file: ref.file,
      ref: ref.ref,
      text: resolved.rawText,
      added: resolved.added,
      removed: resolved.removed,
      sha256: sha256(resolved.rawText),
      language: resolved.language,
      lines: resolved.lines,
      rawText: resolved.rawText,
    } as ResolvedDiff;
  };
}

function buildAssetResolver(opts: ExecuteHyperframeOpts): HyperframeContext<Record<string, unknown>>["asset"] {
  return (inputName: string): ResolvedAsset => {
    const input = opts.compiledScene.hyperframe?.inputs[inputName];
    if (!input || input.kind !== "asset") throw new Error(`Unknown asset hyperframe input "${inputName}".`);
    const asset = opts.runtime.spec.assets[input.target];
    const compiled = opts.runtime.plan.assets[input.target];
    if (!asset || !compiled)
      throw new Error(`Hyperframe input "${inputName}" points at missing asset "${input.target}".`);
    if (asset.type === "data") {
      return {
        type: "data",
        id: input.target,
        src: asset.src,
        sha256: compiled.sha256,
        data: opts.runtime.assetData.get(input.target),
      };
    }
    const path = opts.runtime.assetPaths.get(input.target);
    if (!path) throw new Error(`Compiled asset "${input.target}" is missing its local path.`);
    if (asset.type === "audio") {
      return {
        type: "audio",
        id: input.target,
        src: asset.src,
        sha256: compiled.sha256,
        durationMs: compiled.durationMs ?? 0,
        path,
      };
    }
    return {
      type: "image",
      id: input.target,
      src: asset.src,
      sha256: compiled.sha256,
      width: compiled.width ?? 0,
      height: compiled.height ?? 0,
      path,
    };
  };
}

function buildRangeResolver(
  opts: ExecuteHyperframeOpts,
  atMs: number,
): HyperframeContext<Record<string, unknown>>["range"] {
  return (idOrRef: string): ResolvedRange => {
    const input = opts.compiledScene.hyperframe?.inputs[idOrRef];
    if (input?.kind === "range") return rangeFromSpan(input, atMs);
    const range = opts.compiledScene.ranges[idOrRef];
    if (range) return rangeFromSpan(range, atMs);
    throw new Error(
      `Unknown range "${idOrRef}" in scene "${opts.compiledScene.id}". Declare it in visual.inputs or scene.ranges.`,
    );
  };
}

function buildContext(opts: ExecuteHyperframeOpts): HyperframeContext<Record<string, unknown>> {
  if (opts.scene.visual.kind !== "hyperframe") throw new Error("Scene visual is not a hyperframe.");
  const dims = dimsFor(opts.aspectRatio);
  const cue = activeCue(opts.compiledScene, opts.moment);
  const atMs = sampleTimeMs(opts.compiledScene, opts.moment);
  const sceneMs = atMs - opts.compiledScene.startMs;
  return {
    props: opts.scene.visual.props,
    viewport: {
      width: dims.width,
      height: dims.height,
      aspectRatio: opts.aspectRatio,
      fps: opts.runtime.spec.meta.fps,
    },
    scene: {
      id: opts.compiledScene.id,
      index: opts.compiledScene.index,
      startMs: opts.compiledScene.startMs,
      durationMs: opts.compiledScene.durationMs,
      progress: opts.moment?.progress ?? 1,
      lineIndex: opts.moment?.lineIndex ?? 0,
      lineCount: opts.moment?.lineCount ?? opts.compiledScene.narration.lines.length,
      lineId: cue?.lineId,
    },
    time: {
      absoluteMs: atMs,
      sceneMs,
      frame: Math.round((atMs * opts.runtime.spec.meta.fps) / 1000),
    },
    range: buildRangeResolver(opts, atMs),
    repo: buildRepoResolver(opts),
    asset: buildAssetResolver(opts),
    captions: {
      safeArea: {
        top: 0,
        right: 0,
        bottom: Math.round(Math.min(dims.width, dims.height) * 0.15),
        left: 0,
      },
      activeCue: cue,
      timing: "estimated",
    },
    theme: hyperframeThemeFromSpec(opts.runtime.spec),
    random(key: string) {
      return deterministicRandom(
        `${opts.compiledScene.hyperframe?.sourceSha256 ?? opts.compiledScene.id}:${opts.compiledScene.id}:${key}`,
      );
    },
  };
}

export async function executeHyperframe(opts: ExecuteHyperframeOpts): Promise<ExecutedHyperframe> {
  const module = await loadHyperframeModule(opts.runtime.bundleDir, opts.scene);
  const ctx = buildContext(opts);
  const element = module.render(ctx);
  if (!element || typeof element !== "object" || typeof element.type !== "string") {
    throw new Error("Hyperframe render(ctx) must return a hyperframe element tree.");
  }
  return { element, activeCue: ctx.captions.activeCue };
}
