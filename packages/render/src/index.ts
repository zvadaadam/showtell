/** Public render API. Simple specs lower into the same bundle-v3 runtime. */
export { probeDurationMs } from "@showtell/providers";

export { startPreviewServer, resolvePlayerDist, type PreviewHandle } from "./preview.ts";
export { compileBundle, renderBundle, BundleCompileError } from "./bundle.ts";
export type { BundleCompileResult, BundleRenderResult, CompiledBundlePlan, CompiledBundleOutput } from "./bundle.ts";
export { reviewBundle, BundleReviewError, MAX_REVIEW_SAMPLES_PER_LINE } from "./review.ts";
export type {
  BundleReviewAspectMetrics,
  BundleReviewResult,
  BundleReviewSample,
  BundleReviewScene,
  BundleReviewLine,
} from "./review.ts";
export { renderBundleWorkshop, startWorkshopServer } from "./workshop.ts";
export type { WorkshopRenderResult, WorkshopRenderedFrame, WorkshopHandle } from "./workshop.ts";
export {
  webRuntimeIdentity,
  webRuntimeManifest,
  webComponentManifest,
  webCssVariables,
  webStarterTemplates,
} from "./web-authoring.ts";
export type { WebRuntimeIdentity } from "./web-authoring.ts";
export { checkWebRuntime } from "./web-frame.ts";

export { renderFrames, renderVideo } from "./simple-render.ts";
export type {
  FrameInfo,
  ResolvedInfo,
  RenderFramesResult,
  RenderVideoResult,
  SceneTiming,
  VideoOutput,
} from "./simple-render.ts";
