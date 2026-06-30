export { detectScreenDevice, recordScreen, type RecordOpts } from "./record.ts";
export {
  capturesDir,
  ensureCapturesDir,
  sessionPath,
  resolveSession,
  ensureSyntheticSession,
  assertValidSessionId,
  importCaptureSession,
} from "./sessions.ts";
export { compositeScreencap, type CompositeOpts } from "./composite.ts";
export {
  computeCameraTimeline,
  type CaptureEvent,
  type CaptureEventType,
  type CameraKeyframe,
  type CameraOpts,
} from "./camera.ts";
export {
  toCaptureEvent,
  recordCaptureEvent,
  loadSessionEvents,
  writeSessionEvents,
  normalizeCaptureEvents,
  type BrowserAction,
} from "./events.ts";
export {
  createActionPlaybackPlan,
  createSmartPlaybackPlan,
  createVisualPlaybackPlan,
  remapEventsToPlayback,
  isMeaningfulCaptureEvent,
  DEFAULT_ACTION_PLAYBACK_CONFIG,
  type ActivityWindow,
  type ActionPlaybackConfig,
  type PlaybackPlan,
  type PlaybackSegment,
} from "./playback.ts";
export {
  alignEventsToVisualActivity,
  analyzeVisualActivity,
  DEFAULT_VISUAL_ACTIVITY_CONFIG,
  type VisualActivityConfig,
  type VisualActivityInterval,
  type VisualActivityResult,
} from "./activity.ts";
export {
  externalStatePath,
  readExternalCaptureState,
  runCapturedCommand,
  runCommand,
  startExternalCaptureSession,
  stopExternalCaptureSession,
  writeExternalCaptureState,
  type CapturedCommandResult,
  type CommandResult,
  type ExternalCaptureState,
} from "./external.ts";
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
