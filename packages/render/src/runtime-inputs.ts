import { createHash } from "node:crypto";
import { extname } from "node:path";
import { readFileSync } from "node:fs";
import { resolveCodeRef, resolveDiff, type BundleScene } from "@showtell/core";
import type {
  BundleCompileResult,
  CompiledBundleScene,
  CompiledBundleVisualInput,
  CompiledBundleSpan,
} from "./bundle.ts";

export interface ResolvedVisualCodeInput {
  kind: "code";
  id: string;
  file: string;
  ref?: string;
  lineStart?: number;
  lineEnd?: number;
  focus?: number[];
  language?: string;
  text: string;
  sha256: string;
}

export interface ResolvedVisualDiffInput {
  kind: "diff";
  id: string;
  file: string;
  ref: string;
  text: string;
  added: number;
  removed: number;
  sha256: string;
  rawText: string;
  language?: string;
  lines: ReturnType<typeof resolveDiff>["lines"];
}

export type ResolvedVisualRepoInput = ResolvedVisualCodeInput | ResolvedVisualDiffInput;

export type ResolvedVisualAssetInput =
  | { kind: "data"; id: string; src: string; sha256: string; data: unknown }
  | {
      kind: "image";
      id: string;
      src: string;
      sha256: string;
      width: number;
      height: number;
      dataUrl: string;
    }
  | { kind: "audio"; id: string; src: string; sha256: string; durationMs: number };

export interface ResolvedVisualRangeInput extends CompiledBundleSpan {
  kind: "range";
  id: string;
  target: string;
}

export type ResolvedVisualInput = ResolvedVisualRepoInput | ResolvedVisualAssetInput | ResolvedVisualRangeInput;

export interface ResolvedVisualInputs {
  inputs: Record<string, ResolvedVisualInput>;
  resolvedRefs: { file: string; text: string }[];
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function assertCompiledHash(kind: string, id: string, expected: string, actual: string): void {
  if (actual === expected) return;
  throw new Error(
    `${kind} "${id}" changed after compile (expected ${expected}, received ${actual}). ` +
      "Re-run bundle compile before rendering.",
  );
}

function compiledInputs(scene: CompiledBundleScene): Record<string, CompiledBundleVisualInput> {
  return scene.program.kind === "web" ? scene.program.inputs : {};
}

function imageMime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

function resolveRepoInput(
  runtime: BundleCompileResult,
  scene: BundleScene,
  compiledScene: CompiledBundleScene,
  inputName: string,
  input: Extract<CompiledBundleVisualInput, { kind: "repo" }>,
): ResolvedVisualRepoInput {
  const ref = scene.refs[input.target];
  const compiled = compiledScene.refs[input.target];
  if (!ref) throw new Error(`Visual input "${inputName}" points at missing repo ref "${input.target}".`);
  if (!compiled) throw new Error(`Compiled repo ref "${input.target}" is missing from the scene plan.`);
  if (ref.kind === "code") {
    const resolved = resolveCodeRef(runtime.repoPath, ref);
    const currentSha256 = sha256(resolved.text);
    assertCompiledHash("Repo ref", input.target, compiled.sha256, currentSha256);
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
      sha256: currentSha256,
    };
  }
  const resolved = resolveDiff(runtime.repoPath, { file: ref.file, ref: ref.ref, animation: "magic-move" });
  const currentSha256 = sha256(resolved.rawText);
  assertCompiledHash("Repo ref", input.target, compiled.sha256, currentSha256);
  return {
    kind: "diff",
    id: input.target,
    file: ref.file,
    ref: ref.ref,
    text: resolved.rawText,
    rawText: resolved.rawText,
    added: resolved.added,
    removed: resolved.removed,
    sha256: currentSha256,
    language: resolved.language,
    lines: resolved.lines,
  };
}

function resolveAssetInput(
  runtime: BundleCompileResult,
  inputName: string,
  input: Extract<CompiledBundleVisualInput, { kind: "asset" }>,
): ResolvedVisualAssetInput {
  const asset = runtime.spec.assets[input.target];
  const compiled = runtime.plan.assets[input.target];
  if (!asset || !compiled) throw new Error(`Visual input "${inputName}" points at missing asset "${input.target}".`);
  const path = runtime.assetPaths.get(input.target);
  if (!path) throw new Error(`Compiled asset "${input.target}" is missing its local path.`);
  const bytes = readFileSync(path);
  const currentSha256 = sha256(bytes);
  assertCompiledHash("Asset", input.target, compiled.sha256, currentSha256);
  if (asset.type === "data") {
    return {
      kind: "data",
      id: input.target,
      src: asset.src,
      sha256: currentSha256,
      data: runtime.assetData.get(input.target),
    };
  }
  if (asset.type === "audio") {
    return {
      kind: "audio",
      id: input.target,
      src: asset.src,
      sha256: currentSha256,
      durationMs: compiled.durationMs ?? 0,
    };
  }
  return {
    kind: "image",
    id: input.target,
    src: asset.src,
    sha256: currentSha256,
    width: compiled.width ?? 0,
    height: compiled.height ?? 0,
    dataUrl: `data:${imageMime(path)};base64,${bytes.toString("base64")}`,
  };
}

const cache = new WeakMap<CompiledBundleScene, ResolvedVisualInputs>();

/** Resolve declared visual ports once per compiled scene from live repo bytes and bundle assets. */
export function resolveVisualInputs(
  runtime: BundleCompileResult,
  scene: BundleScene,
  compiledScene: CompiledBundleScene,
): ResolvedVisualInputs {
  const hit = cache.get(compiledScene);
  if (hit) return hit;

  const inputs: Record<string, ResolvedVisualInput> = {};
  const resolvedRefs: { file: string; text: string }[] = [];
  for (const [name, input] of Object.entries(compiledInputs(compiledScene))) {
    if (input.kind === "repo") {
      const resolved = resolveRepoInput(runtime, scene, compiledScene, name, input);
      inputs[name] = resolved;
      resolvedRefs.push({ file: resolved.file, text: resolved.kind === "code" ? resolved.text : resolved.rawText });
    } else if (input.kind === "asset") {
      inputs[name] = resolveAssetInput(runtime, name, input);
    } else {
      inputs[name] = { ...input, id: name };
    }
  }

  const result = { inputs, resolvedRefs };
  cache.set(compiledScene, result);
  return result;
}
