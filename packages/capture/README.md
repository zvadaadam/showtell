# @agent-video/capture

Mode A: macOS screen recording (avfoundation) composited into the timeline as a
`screencap` scene. Adapted from [@deus/screen-studio](https://github.com/) (MIT).

- `recordScreen(opts)` — record the screen for a fixed duration (needs Screen Recording permission).
- `sessions.ts` — sandbox-safe session store (`.agent-video/captures/<id>.mp4`); rejects path traversal.
- `compositeScreencap(opts)` — fit the recording to the frame, hold to the narration length, mux + watermark.

macOS-only in v1. Internal package of [agent-video](../../README.md).
