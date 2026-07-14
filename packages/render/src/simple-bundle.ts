import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BundleAsset, BundleRepoRef, BundleScene, BundleSpec, Scene, VideoSpec } from "@showtell/core";
import { simpleWebDocument, simpleWebProps } from "./simple-web-templates.ts";

type SimpleWebScene = Exclude<Scene, { kind: "screencap" }>;

export interface LoweredSimpleBundle {
  bundleDir: string;
  /** Bundle scene index -> source simple-spec scene index. */
  sceneMap: number[];
}

export function simpleSceneId(index: number): string {
  return `scene-${String(index).padStart(3, "0")}`;
}

function visualFile(index: number): string {
  return `hyperframes/${simpleSceneId(index)}.html`;
}

function chartAssetId(index: number): string {
  return `data-${String(index).padStart(3, "0")}`;
}

function repoRef(scene: SimpleWebScene): BundleRepoRef | undefined {
  if (scene.kind === "code") {
    return {
      kind: "code",
      file: scene.content.file,
      lineStart: scene.content.lineStart,
      lineEnd: scene.content.lineEnd,
      ref: scene.content.ref,
      focus: scene.content.focus,
      language: scene.content.language,
    };
  }
  if (scene.kind === "diff") {
    return { kind: "diff", file: scene.content.file, ref: scene.content.ref };
  }
  return undefined;
}

function lowerWebScene(scene: SimpleWebScene, sourceIndex: number): BundleScene {
  const source = repoRef(scene);
  const dataId = chartAssetId(sourceIndex);
  return {
    id: simpleSceneId(sourceIndex),
    duration: scene.duration,
    narration: { lines: [{ id: "l1", text: scene.narration }] },
    refs: source ? { source } : {},
    beats: [],
    anchors: [],
    ranges: {},
    visual: {
      kind: "web",
      src: visualFile(sourceIndex),
      props: simpleWebProps(scene),
      inputs: {
        ...(source ? { source: "source" } : {}),
        ...(scene.kind === "chart" ? { data: dataId } : {}),
        reveal: "line:l1",
      },
    },
  };
}

function lowerScene(scene: Scene, sourceIndex: number): BundleScene {
  if (scene.kind !== "screencap") return lowerWebScene(scene, sourceIndex);
  return {
    id: simpleSceneId(sourceIndex),
    duration: scene.duration,
    narration: { lines: [{ id: "l1", text: scene.narration }] },
    refs: {},
    beats: [],
    anchors: [],
    ranges: {},
    visual: {
      kind: "screencap",
      sessionRef: scene.content.sessionRef,
      clip: scene.content.clip,
      playback: scene.content.playback,
    },
  };
}

/**
 * Deterministically lower simple authoring sugar into a normal v3 bundle.
 * From this point onward validation, timing, Chromium capture, screencap
 * scheduling, audio, and encoding are exactly the bundle pipeline.
 */
export function lowerSimpleSpec(
  spec: VideoSpec,
  opts: { bundleDir: string; repoPath: string; sceneIndices?: number[] },
): LoweredSimpleBundle {
  const bundleDir = resolve(opts.bundleDir);
  const sceneMap = opts.sceneIndices ?? spec.scenes.map((_scene, index) => index);
  mkdirSync(join(bundleDir, "hyperframes"), { recursive: true });
  mkdirSync(join(bundleDir, "assets", "data"), { recursive: true });

  const assets: Record<string, BundleAsset> = {};
  const scenes = sceneMap.map((sourceIndex) => {
    const scene = spec.scenes[sourceIndex];
    if (!scene) throw new Error(`Simple scene index ${sourceIndex} does not exist.`);
    if (scene.kind !== "screencap") {
      writeFileSync(join(bundleDir, visualFile(sourceIndex)), simpleWebDocument(scene));
    }
    if (scene.kind === "chart") {
      const id = chartAssetId(sourceIndex);
      const src = `assets/data/${simpleSceneId(sourceIndex)}.json`;
      assets[id] = { type: "data", src };
      writeFileSync(join(bundleDir, src), `${JSON.stringify(scene.content.data, null, 2)}\n`);
    }
    return lowerScene(scene, sourceIndex);
  });

  const bundle: BundleSpec = {
    version: 3,
    meta: {
      title: spec.meta.title,
      fps: spec.meta.fps,
      aspectRatios: spec.meta.aspectRatios,
      theme: { preset: "ink", colors: {}, typography: {} },
      repo: {
        path: resolve(opts.repoPath),
        baseRef: spec.meta.repo.baseRef,
        headRef: spec.meta.repo.headRef,
      },
    },
    assets,
    audio: {
      tts: spec.meta.tts ?? { provider: "say" },
      captions: { mode: "off", source: "narration" },
      music: [],
    },
    scenes,
  };
  writeFileSync(join(bundleDir, "spec.json"), `${JSON.stringify(bundle, null, 2)}\n`);
  return { bundleDir, sceneMap };
}
