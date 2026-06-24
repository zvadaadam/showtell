# agent-video — agent guide

**What this is:** "Loom for agents" — a local, repo-aware video renderer. A coding agent authors a `spec.json` and the renderer turns it into a short narrated MP4. Being local is the moat: code/diff scenes reference the repo by `file:line`/git ref and the renderer reads the **live bytes**, so rendered code is always ground-truth.

**Read first:** `.context/interview-me/agent-video-product.md` (the `## Plan`) and `.context/plan/agent-video-goal.md`. Progress + gate ledger: `.context/plan/agent-video-progress.md`.

## The contract (never violate)
- The LLM authors **only** a JSON-Schema-validated `spec.json` (`meta` + ordered `scenes[]`, each with `narration`). It NEVER writes ffmpeg, frame math, or pasted source.
- `code`/`diff` scenes carry repo **references** (`file`, `lineStart/End`, git `ref`), never pasted code.
- Scenes use `duration: "auto"` → the renderer is **two-pass** (synthesize TTS → measure with ffprobe → lay out visuals so audio/visuals stay synced).
- Deterministic: same spec → same mp4. No `Date.now()` / unseeded `Math.random()` in render components. Content-hash cache; TTS cached per narration line.

## Agent-first (primary success metric)
Every CLI command and MCP tool must be: non-interactive, all-flags, **structured JSON output**, actionable errors with a `hint` field, idempotent, and self-describing via `--help` + rich tool descriptions with examples. A fresh agent given only the SKILL + `--help` must drive the whole pipeline unaided.

## Layout (bun workspaces)
- `packages/core` — spec types + published JSON Schema + git/diff parsing + timeline assembler
- `packages/compose` — Mode B: spec → frames (hyperframes), responsive 16:9 + 9:16
- `packages/capture` — Mode A: ported `screen-studio` (avfoundation, macOS-only)
- `packages/providers` — BYO-API model gateway (TTS: Replicate/OpenAI/ElevenLabs + local `say`)
- `packages/render` — orchestrator: validate → resolve refs → TTS → measure → compose+capture → ffmpeg mux + watermark → mp4
- `packages/cli` — `agent-video` binary
- `packages/mcp` — MCP server over the same render library as the CLI (shares `renderVideo`, not a CLI shell-out)
- `skills/agent-video`, `skills/agent-video-eval`

## Conventions
- Runtime: **bun** (runs TS directly; no build step needed in dev). Lint: **oxlint**. Tests: `bun test`.
- Prereq: `ffmpeg` (`brew install ffmpeg`).
- Run the CLI locally: `bun packages/cli/src/index.ts <command>`.
