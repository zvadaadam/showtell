# @agent-video/cli

The `agent-video` binary. Agent-first: every command is non-interactive, emits
structured JSON, and returns actionable errors with a `hint`.

## Commands

- `agent-video validate <spec.json>` - Validate a spec against the contract.
- `agent-video render <spec.json>` - Render a spec to MP4 or scene PNGs.
- `agent-video preview <spec.json>` - Render, then serve the web player locally.
- `agent-video capture` - Record the screen into a screencap capture session.
- `agent-video capture import <file>` - Import a recording into a capture session.
- `agent-video capture event` - Append one action event to a session sidecar.
- `agent-video capture analyze` - Inspect visual activity in a capture.
- `agent-video capture start-external` - Start tracking an external recorder.
- `agent-video capture exec` - Run a CLI action and record an inferred event window.
- `agent-video capture stop-external` - Stop external tracking and import the recording.
- `agent-video bundle validate <dir>` - Validate a v2 bundle directory.
- `agent-video bundle inspect <dir>` - Print scenes, refs, ranges, and hyperframe ports.
- `agent-video bundle compile <dir>` - Resolve refs/assets/ranges and write `compiled-plan.json`.
- `agent-video bundle render <dir>` - Compile and render a v2 bundle to MP4.
- `agent-video bundle workshop <dir>` - Render bundle scene/line/aspect PNGs to a gallery.
- `agent-video bundle components` - List reusable hyperframe components.
- `agent-video bundle templates` - List reusable hyperframe starter templates.
- `agent-video bundle schema` - Print the v2 bundle JSON Schema.
- `agent-video workshop render` - Render the built-in component workshop gallery.
- `agent-video eval` - Render the golden example and return pass/fail JSON.
- `agent-video schema` - Print the published JSON Schema for simple `spec.json`.
- `agent-video version` - Print the version as JSON.

See [docs/bundle-v2.md](../../docs/bundle-v2.md) for the bundle authoring model.

Build a standalone binary with `bun run build:cli`. Part of [agent-video](../../README.md).
