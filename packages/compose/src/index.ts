export { renderWatermarkPng } from "./render-watermark.ts";
export { captionSafeArea, drawCaptionOverlay, renderCaptionPng } from "./render-caption.ts";
export { decodeFramePng, renderFrameChrome } from "./render-frame-chrome.ts";
export type { CompositedFrame, FrameChromeOptions } from "./render-frame-chrome.ts";
export { drawPresenterOverlay, loadPresenterOverlay, presenterSafeArea, renderPresenterPng } from "./presenter.ts";
export { AGENT_LOGO_IDS, resolveAgentLogo, type AgentLogo } from "./agent-logos.ts";
export type {
  LoadedPresenter,
  PresenterOverlayState,
  PresenterPosition,
  PresenterSafeArea,
  PresenterSize,
} from "./presenter.ts";
export { dimsFor, type Dims } from "./dims.ts";
export { probeImageInfo } from "./image-info.ts";
export type { ImageInfo } from "./image-info.ts";
export { THEME, canvasTheme, type CanvasTheme } from "./theme.ts";
