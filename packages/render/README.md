# @showtell/render

The orchestrator. Turns a validated spec into mp4(s) through a deterministic
**two-pass** pipeline: resolve refs → TTS → measure audio → seek browser visuals
at exact frames → composite renderer chrome → ffmpeg mux. It also serves the
local preview.

- `renderVideo(spec, opts)` — lower a simple spec to browser programs, then render an MP4 per aspect ratio.
- `renderFrames(spec, opts)` — compile the same motion timing and capture representative browser PNGs without encoding video.
- `compileBundle` / `renderBundle` — browser-authored bundle → narrated MP4.
- `reviewBundle` / `renderBundleWorkshop` — exact-timestamp motion and held-state review.
- `startPreviewServer(opts)` — a localhost watch page; returns a stable `watchUrl`.

Internal package of [showtell](../../README.md).
