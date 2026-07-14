# @showtell/cli

The `showtell` binary. Agent-first: every command is non-interactive, emits
structured JSON, and returns actionable errors with a `hint`.

## Commands

- `showtell validate <spec.json>` - Validate a spec against the contract.
- `showtell render <spec.json>` - Render a spec to MP4 or scene PNGs.
- `showtell preview <spec.json>` - Render, then serve the web player locally.
- `showtell capture` - Record the screen into a screencap capture session.
- `showtell capture import <file>` - Import a recording into a capture session.
- `showtell capture event` - Append one action event to a session sidecar.
- `showtell capture analyze` - Inspect visual activity in a capture.
- `showtell capture start-external` - Start tracking an external recorder.
- `showtell capture exec` - Run a CLI action and record an inferred event window.
- `showtell capture stop-external` - Stop external tracking and import the recording.
- `showtell bundle validate <dir>` - Validate a version 3 web/screencap bundle.
- `showtell bundle inspect <dir>` - Print scenes, refs, ranges, visual ports, and runtime identity.
- `showtell bundle compile <dir>` - Resolve refs/assets/ranges and write `compiled-plan.json`.
- `showtell bundle review <dir>` - Sample exact video timestamps into a motion filmstrip gallery.
- `showtell bundle render <dir>` - Compile and render a version 3 web/screencap bundle to MP4.
- `showtell bundle workshop <dir>` - Render representative held bundle scene/line/aspect PNGs to a layout gallery.
- `showtell bundle components` - List the bundle-v3 browser components and deterministic runtime surface.
- `showtell bundle templates` - List copyable bundle-v3 HTML/CSS/GSAP starters.
- `showtell bundle themes` - List semantic video theme presets.
- `showtell bundle runtime` - Launch and verify the pinned Chromium runtime.
- `showtell bundle schema` - Print the versioned bundle JSON Schema.
- `showtell eval` - Render the golden example and return pass/fail JSON.
- `showtell schema` - Print the published JSON Schema for simple `spec.json`.
- `showtell version` - Print the version as JSON.

Use [docs/bundle-v3.md](../../docs/bundle-v3.md) for crafted videos.

Build a standalone binary with `bun run build:cli`. Part of [showtell](../../README.md).
