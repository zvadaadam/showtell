# @showtell/capture

Mode A: macOS screen recording (avfoundation) composited into the timeline as a
`screencap` scene. Adapted from [@deus/screen-studio](https://github.com/) (MIT).

- `recordScreen(opts)` — record the screen for a fixed duration (needs Screen Recording permission).
- `sessions.ts` — sandbox-safe session store (`.showtell/captures/<id>.mp4`); rejects path traversal.
- `activity.ts` — visual activity analysis for driver-agnostic smart trimming and event-window alignment.
- `external.ts` — external CLI bridge: supervise real tool commands and write optional event sidecars.
- `workflow.ts` — agent-facing import/analyze/start/exec/stop workflows used by the CLI.
- `compositeScreencap(opts)` — trim playback, optionally follow the camera, add tap/type feedback, mux + watermark.

macOS-only in v1. Internal package of [showtell](../../README.md).
