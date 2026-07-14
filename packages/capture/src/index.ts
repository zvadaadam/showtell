export { recordScreen } from "./record.ts";
export {
  DETERMINISTIC_AUDIO_ARGS,
  DETERMINISTIC_CONTAINER_ARGS,
  DETERMINISTIC_VIDEO_ARGS,
  FASTSTART_ARGS,
} from "./encode.ts";
export { ensureCapturesDir, sessionPath, resolveSession, ensureSyntheticSession } from "./sessions.ts";
export { compositeScreencap, type ScreencapOverlay } from "./composite.ts";
export { computeCameraTimeline, type CaptureEvent, type CaptureEventType, type CameraKeyframe } from "./camera.ts";
export { recordCaptureEvent, loadSessionEvents, normalizeCaptureEvents } from "./events.ts";
export {
  createActionPlaybackPlan,
  createSmartPlaybackPlan,
  remapEventsToPlayback,
  type ActionPlaybackConfig,
  type PlaybackPlan,
} from "./playback.ts";
export { alignEventsToVisualActivity, analyzeVisualActivity, type VisualActivityConfig } from "./activity.ts";
export {
  analyzeCaptureWorkflow,
  execCapturedCommandWorkflow,
  importCaptureWorkflow,
  startExternalCaptureWorkflow,
  stopExternalCaptureWorkflow,
  type CaptureAnalyzeWorkflowResult,
  type CaptureExecWorkflowResult,
  type CaptureImportWorkflowResult,
  type CaptureStartExternalWorkflowResult,
  type CaptureStopExternalWorkflowResult,
  type CaptureWorkflowError,
} from "./workflow.ts";
