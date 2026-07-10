# @showtell/render

The orchestrator. Turns a validated spec into mp4(s) — the deterministic **two-pass**
pipeline: resolve refs → TTS → measure audio (set `auto` durations) → draw scenes →
ffmpeg mux + watermark. Also serves the local preview.

- `renderVideo(spec, opts)` — spec → mp4 per aspect ratio (`{ videoId, outputs, resolvedCode, warnings }`).
- `renderFrames(spec, opts)` — silent PNG frames only (fast, for iterating on layout).
- `startPreviewServer(opts)` — a localhost watch page; returns a stable `watchUrl`.

Internal package of [showtell](../../README.md).
