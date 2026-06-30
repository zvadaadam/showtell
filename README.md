# agent-video

**Loom for agents** — a local, repo-aware video renderer. Instead of writing you an
answer, a coding agent makes you a short **narrated video**. Because it runs locally,
it reads your real `git diff`, files at `file:line`, and a running app — so the code on
screen is always your actual code, not a paraphrase.

```
spec.json  ──▶  agent-video render  ──▶  out-16x9.mp4 + out-9x16.mp4
(scenes +        (deterministic:           (narrated, watermarked)
 narration)       refs → live bytes →
                  TTS → ffmpeg)
```

## Quickstart

Prereqs: [bun](https://bun.sh) and [ffmpeg](https://ffmpeg.org) (`brew install ffmpeg`).

```bash
bun install
bun run build:cli                 # → ./dist/agent-video (a standalone binary)

./dist/agent-video validate examples/how-it-works.spec.json
./dist/agent-video render   examples/how-it-works.spec.json --out .agent-video/out
./dist/agent-video preview  examples/how-it-works.spec.json   # serves a local watch page
```

During development you can skip the build and run the CLI directly: `bun packages/cli/src/index.ts <cmd>`.

## The one rule

You (or an agent) author **only** a `spec.json` — an ordered list of scenes, each with
`narration`. You **never** write ffmpeg, frame math, or paste source code. `code`/`diff`
scenes carry **references** (`file`, `lineStart`/`lineEnd`, git `ref`); the renderer reads
the live bytes, so the code is always ground-truth.

```jsonc
{
  "meta": { "title": "PR: idempotency keys", "aspectRatios": ["16:9", "9:16"], "repo": { "path": "." } },
  "scenes": [
    {
      "kind": "title",
      "content": { "heading": "Idempotency keys" },
      "narration": "This PR makes the webhook safe to retry.",
      "duration": "auto",
    },
    {
      "kind": "diff",
      "content": { "file": "src/webhook.ts", "ref": "main..HEAD" },
      "narration": "We check the key before processing.",
      "duration": "auto",
    },
  ],
}
```

Six scene kinds: **title · code · diff · talking-points · chart · screencap**. Every scene
has `narration` + `"duration": "auto"` (length derived from the spoken audio).
Run `agent-video schema` for the full contract.

## Two modes

- **Compose** (Mode B) — the renderer draws scenes (code, diffs, charts, titles) from your
  repo. Deterministic: same spec → same mp4.
- **Capture** (Mode A) — a `screencap` scene composites a real screen recording, for
  showing a running app or demo. `playback.mode: "smart"` removes visually idle time
  from any recording, and uses click/type/scroll/navigate events when available for
  better presentation. Wrapped external CLI actions record a start/end event window;
  smart playback aligns that cue to visual activity so delayed tool dispatch does not
  highlight stale frames. Landscape/desktop captures use ScreenStudio-style camera
  follow by default; portrait/mobile captures stay full-frame and show tap/type
  feedback instead.

```bash
agent-video capture start-external ./demo.webm --id demo -- agent-browser record start ./demo.webm
agent-video capture exec --id demo -- agent-browser click @submit
agent-video capture exec --id demo -- agent-browser type @email "dev@example.com"
agent-video capture stop-external --id demo -- agent-browser record stop
agent-video capture analyze --id demo
```

```jsonc
{
  "kind": "screencap",
  "content": {
    "source": "browser",
    "sessionRef": "demo",
    "playback": { "mode": "smart", "camera": "auto", "actionEffects": "auto" },
  },
  "narration": "Here is the useful interaction without the dead air.",
  "duration": "auto",
}
```

## For agents

agent-video is built to be driven by a coding agent: the `agent-video` CLI and the MCP server
(`packages/mcp`) are agent-first — structured JSON output, actionable errors with a `hint`,
self-describing `--help`. The [`skills/agent-video`](skills/agent-video/SKILL.md) skill teaches
an agent the workflow (gather `git diff` → author `spec.json` → validate → render → report).

## Packages

| Package                           | Role                                                 |
| --------------------------------- | ---------------------------------------------------- |
| [`core`](packages/core)           | spec types + JSON Schema + git/diff resolver         |
| [`compose`](packages/compose)     | Mode B: spec scenes → frames (canvas + Shiki)        |
| [`capture`](packages/capture)     | Mode A: screen recordings → directed screencap clips |
| [`providers`](packages/providers) | TTS gateway (narration audio)                        |
| [`render`](packages/render)       | orchestrator: spec → mp4 (two-pass) + local preview  |
| [`cli`](packages/cli)             | the `agent-video` binary                             |
| [`mcp`](packages/mcp)             | MCP server over the same render library              |

## Development

```bash
bun run lint          # oxlint
bun run format        # prettier
bun run typecheck     # tsc --noEmit
bun test              # bun test
bun packages/cli/src/index.ts eval   # deterministic end-to-end self-test
```

A lefthook pre-commit hook runs lint + format + typecheck. CI runs the full suite on macOS.

## License

MIT — see [LICENSE](LICENSE). Portions of `packages/capture` are adapted from
[@deus/screen-studio](https://github.com/) (MIT).
