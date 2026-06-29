export { detectScreenDevice, recordScreen, type RecordOpts } from "./record.ts";
export {
  capturesDir,
  ensureCapturesDir,
  sessionPath,
  resolveSession,
  ensureSyntheticSession,
  assertValidSessionId,
} from "./sessions.ts";
export { compositeScreencap, type CompositeOpts } from "./composite.ts";
export {
  computeCameraTimeline,
  type CaptureEvent,
  type CaptureEventType,
  type CameraKeyframe,
  type CameraOpts,
} from "./camera.ts";
export { toCaptureEvent, recordCaptureEvent, loadSessionEvents, type BrowserAction } from "./events.ts";
