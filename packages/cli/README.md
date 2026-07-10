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
- `showtell bundle validate <dir>` - Validate a v2 bundle directory.
- `showtell bundle inspect <dir>` - Print scenes, refs, ranges, and hyperframe ports.
- `showtell bundle compile <dir>` - Resolve refs/assets/ranges and write `compiled-plan.json`.
- `showtell bundle render <dir>` - Compile and render a v2 bundle to MP4.
- `showtell bundle workshop <dir>` - Render bundle scene/line/aspect PNGs to a gallery.
- `showtell bundle components` - List reusable hyperframe components.
- `showtell bundle templates` - List reusable hyperframe starter templates.
- `showtell bundle schema` - Print the v2 bundle JSON Schema.
- `showtell workshop render` - Render the built-in component workshop gallery.
- `showtell eval` - Render the golden example and return pass/fail JSON.
- `showtell schema` - Print the published JSON Schema for simple `spec.json`.
- `showtell version` - Print the version as JSON.

See [docs/bundle-v2.md](../../docs/bundle-v2.md) for the bundle authoring model.

Build a standalone binary with `bun run build:cli`. Part of [showtell](../../README.md).
