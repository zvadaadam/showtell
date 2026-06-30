---
name: agent-video
description: >-
  Produce a short narrated VIDEO instead of a text answer — a local, repo-aware
  walkthrough. Use when the user asks to "make a video", "record a walkthrough",
  "explain this PR/change/codebase as a video", "demo this", or wants a shareable
  Loom-style recap of work. Renders locally from the real repo (git diff,
  file:line, terminal, screen capture); never uploads code.
---

# agent-video

Turn your work into a short narrated video. You author a **`spec.json`**; the
`agent-video` CLI renders it to an MP4 (both desktop 16:9 and mobile 9:16) and
serves a live **web player** — a watch surface with chaptered scenes, a
click-to-seek transcript, speed control, and the repo metadata. The deliverable
you hand back is a **running watch URL, not a file**. Because it runs locally,
code/diff scenes reference the repo and the renderer reads the **live bytes** —
the code on screen is always correct.

## Use when

- The user asks for a video / walkthrough / demo / recap of a change, PR, or codebase.
- A short narrated explainer would communicate better than text.

## Don't use when

- The user wants a written answer, or there's nothing visual/temporal to show.

## The one rule

You author **only** the `spec.json` (scenes + narration). You **never** write
ffmpeg, frame math, or paste source code into the spec. `code`/`diff` scenes
carry **references** (`file`, `lineStart`/`lineEnd`, git `ref`); the renderer
reads the file. Pasting code is wrong and will drift from the source.

## Workflow

1. **Gather context** from the real repo: `git diff`, `git log`, changed
   `file:line` ranges, PR/commit messages, test output, README.
2. **Author `spec.json`**: an ordered list of scenes, each with `narration`.
   Keep narration to ~1–2 sentences per scene; the video paces itself to the
   spoken audio (`"duration": "auto"`).
   - **For legibility**, keep `code` excerpts focused (~6–25 lines, lines ≤ ~90
     chars) and point `focus` at the lines your narration calls out. The
     renderer auto-fits the font, so smaller, tighter excerpts read far better.
   - Make narration match what's on screen — don't claim something the frame
     doesn't show.
3. **Validate**: `agent-video validate spec.json` — fix any errors (each has a `hint`).
4. **Render**: `agent-video render spec.json --frames-only` first (fast, no
   audio) and **look at the PNG frames**. Fix any scene where the narration
   describes something the frame doesn't show — this is the #1 quality problem.
   In particular: `diff` shows raw diff text (not a chart); `chart` data is
   **literal numbers you supply** (the renderer does not compute git stats); a
   `code` excerpt shows only its `file:line` window. Make the words match the pixels.
5. **Serve the player**: `agent-video preview spec.json` — renders, then serves
   the web player (chaptered scenes, click-to-seek transcript, speed, metadata,
   16:9/9:16) and returns a stable `watchUrl`. Build the player once first:
   `bun run build:player`.
6. **Report**: reply with the `watchUrl` — a live local URL the user opens, **not
   a file path** — and one sentence describing the video.

## The spec

```jsonc
{
  "meta": {
    "title": "PR #482: idempotency keys",
    "aspectRatios": ["16:9", "9:16"], // desktop, mobile, or "1:1" (default: ["16:9"])
    "tts": { "provider": "say" }, // "say" (macOS), "openai", "replicate", or "elevenlabs" (API keys from env)
    "repo": { "path": ".", "baseRef": "main", "headRef": "HEAD" },
  },
  "scenes": [
    /* ... */
  ],
}
```

### Scene kinds (every scene also has `"narration"` and `"duration": "auto"`)

- **title** — `content: { heading, subtitle? }`. Opener / section card.
- **code** — `content: { file, lineStart?, lineEnd?, ref?, focus?: number[] }`.
  Syntax-highlighted excerpt read from the repo. `focus` emphasizes line numbers.
- **diff** — `content: { file, ref, animation?: "magic-move"|"fade" }`.
  `ref` is a git range like `"main..HEAD"`. Renders the real `git diff`. The named
  `file` must actually change in `ref`, or the scene renders empty (render warns).
- **talking-points** — `content: { heading?, points: string[] }`. Bulleted list
  (e.g. what reviewers should check).
- **chart** — `content: { chartType: "bar"|"line"|"pie", title?, data: object[] }`.
  Each datum has **exactly one string key** (the axis label) and one or more
  numeric keys (the series), e.g. `{ "file": "a.ts", "added": 10, "removed": 2 }`.
  One numeric key → one bar per label; multiple → grouped bars + a series legend.
- **screencap** — `content: { source: "app"|"browser"|"desktop", sessionRef, playback? }`.
  Composites a screen recording. First create/import a capture session, then set
  `sessionRef: "NAME"`. Use `playback: { "mode": "smart" }` for demos: the
  renderer removes visually idle time from any recording, and uses an events
  sidecar when present for better presentation. External CLI wrappers record
  start/end event windows; smart playback aligns those cues to visual activity
  so delayed tool dispatch does not show stale frames. `camera: "auto"` follows
  landscape/desktop actions but keeps portrait/mobile captures full-frame;
  `actionEffects: "auto"` adds tap/type feedback when the camera is not
  following. Use `"action-only"` only when you intentionally require
  event-sidecar trimming without visual analysis.

## CLI (all commands emit JSON; errors carry a `hint`)

- `agent-video schema` — print the full JSON Schema for `spec.json`.
- `agent-video validate <spec.json>` — validate against the contract.
- `agent-video render <spec.json> [--out DIR] [--aspect 16:9,9:16] [--frames-only]` — render MP4(s).
- `agent-video preview <spec.json> [--port N]` — render + serve the web player; returns `watchUrl`. (Build the player once: `bun run build:player`.)
- `agent-video capture [--id NAME] [--seconds N]` — record the screen (macOS) for a `screencap` scene.
- `agent-video capture import <recording.webm|mp4> --id NAME [--events events.json]` — import an agent-browser recording.
- `agent-video capture analyze --id NAME` — inspect visual activity before rendering smart playback.
- `agent-video capture start-external <raw.webm|mp4> --id NAME -- <record-start command>` — track an external recorder.
- `agent-video capture exec --id NAME -- <tool command>` — run a real CLI action and record an inferred event window when possible.
- `agent-video capture stop-external --id NAME -- <record-stop command>` — stop tracking and import the raw recording.
- `agent-video capture event --id NAME --type click --x N --y N --t-ms N` — append one action event for smarter camera targets.
  Run `agent-video help` for the latest.

## Output format

Reply with the `watchUrl` and a one-sentence description. Example:

> Here's a 40s walkthrough of the change: http://localhost:4321/ — it covers the new idempotency key, the store, and what reviewers should check.

## Example — PR walkthrough

```json
{
  "meta": { "title": "PR: idempotency keys", "aspectRatios": ["16:9", "9:16"], "repo": { "path": "." } },
  "scenes": [
    {
      "kind": "title",
      "content": { "heading": "Idempotency keys for the webhook", "subtitle": "PR #482 · 4 files · +127 / −34" },
      "narration": "This PR makes our payments webhook safe to retry by adding idempotency keys.",
      "duration": "auto"
    },
    {
      "kind": "diff",
      "content": { "file": "src/payments/webhook.ts", "ref": "main..HEAD" },
      "narration": "Before processing an event we read the idempotency key and check the store; if we've seen it, we short-circuit.",
      "duration": "auto"
    },
    {
      "kind": "code",
      "content": { "file": "src/payments/idempotencyStore.ts", "lineStart": 12, "lineEnd": 30, "focus": [18] },
      "narration": "The store is a thin Redis wrapper with a 24-hour TTL. Line 18 is the atomic set-if-absent.",
      "duration": "auto"
    },
    {
      "kind": "talking-points",
      "content": {
        "heading": "For reviewers",
        "points": [
          "Confirm the 24h TTL matches the provider's retry window.",
          "The cached response is returned verbatim — no per-request data leaks."
        ]
      },
      "narration": "Two things to double-check before shipping.",
      "duration": "auto"
    }
  ]
}
```

Other shapes: a **codebase tour** (title → architecture talking-points → code excerpts),
a **demo** (title → screencap → talking-points), a **release recap** (title → chart of
changes → diff highlights). Same kinds, different composition.
