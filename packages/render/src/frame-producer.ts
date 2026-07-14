import type { AspectRatio, BundleScene } from "@showtell/core";
import { decodeFramePng, renderFrameChrome } from "@showtell/compose";
import type { BundleCompileResult, CompiledBundleScene, ExactBundleFrame } from "./bundle.ts";
import { WebFrameRenderer } from "./web-frame.ts";

export interface FramePresentation {
  watermark?: string | false;
  presenterAmplitude?: number;
  caption?: string;
}

export interface BundleFrameRequest {
  scene: BundleScene;
  compiledScene: CompiledBundleScene;
  aspectRatio: AspectRatio;
  exact: ExactBundleFrame;
  presentation?: FramePresentation;
  diagnostics?: boolean;
}

export interface ProducedBundleFrame {
  basePng: Buffer;
  baseRgba?: Buffer;
  png: Buffer;
  rgba: Buffer;
  width: number;
  height: number;
  resolvedRefs: { file: string; text: string }[];
  warning?: string;
}

export class BundleFrameProducer {
  private readonly web: WebFrameRenderer;

  constructor(private readonly runtime: BundleCompileResult) {
    this.web = new WebFrameRenderer(runtime);
  }

  async render(request: BundleFrameRequest): Promise<ProducedBundleFrame> {
    const { scene, compiledScene, aspectRatio, exact } = request;
    if (scene.visual.kind !== "web" || compiledScene.program.kind !== "web") {
      throw new Error(`Scene "${scene.id}" is timed media, not a browser frame program.`);
    }
    const captured = await this.web.capture(scene, compiledScene, aspectRatio, exact);
    const basePng = captured.png;
    const resolvedRefs = captured.resolvedRefs;

    const presentation = request.presentation;
    const final = await renderFrameChrome(basePng, {
      aspectRatio,
      theme: this.runtime.plan.meta.resolvedTheme,
      watermark: presentation?.watermark ?? "showtell",
      presenter:
        this.runtime.presenter && presentation?.presenterAmplitude !== undefined
          ? { ...this.runtime.presenter, amplitude: presentation.presenterAmplitude }
          : undefined,
      caption: presentation?.caption,
    });
    const diagnostic = request.diagnostics ? await decodeFramePng(basePng, aspectRatio) : undefined;
    return {
      basePng,
      baseRgba: diagnostic?.rgba,
      get png() {
        return final.png;
      },
      get rgba() {
        return final.rgba;
      },
      width: final.width,
      height: final.height,
      resolvedRefs,
    };
  }

  async close(): Promise<void> {
    await this.web.close();
  }
}

export function createBundleFrameProducer(runtime: BundleCompileResult): BundleFrameProducer {
  return new BundleFrameProducer(runtime);
}
