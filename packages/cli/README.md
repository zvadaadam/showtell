# @agent-video/cli

The `agent-video` binary. Agent-first: every command is non-interactive, emits
structured JSON, and returns actionable errors with a `hint`.

```
agent-video validate <spec.json>   schema      help
agent-video render   <spec.json>   preview <spec.json>
agent-video capture                eval        version
```

Build a standalone binary with `bun run build:cli`. Part of [agent-video](../../README.md).
