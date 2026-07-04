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
code/diff visuals reference the repo and the renderer reads the **live bytes** —
the code on screen is always correct.

## Use when

- The user asks for a video / walkthrough / demo / recap of a change, PR, or codebase.
- A short narrated explainer would communicate better than text.

## Don't use when

- The user wants a written answer, or there's nothing visual/temporal to show.

## The one rule

Author intent and visuals; never author execution machinery. For quick videos,
that can be a single `spec.json` with scenes + narration. For richer videos, it
is a bundle with `spec.json`, hyperframes, and declared assets. You **never**
write ffmpeg, frame math, pasted repo source, or `compiled-plan.json`.
`code`/`diff` visuals carry **references** (`file`, `lineStart`/`lineEnd`, git
`ref`); the renderer reads the file. Pasting code is wrong and will drift from
the source.

## Bundle Videos

Use a bundle when the video needs custom pacing, richer layouts, reusable
hyperframes, captions around visuals, music ranges, or multiple repo/data inputs
in one narrated chapter:

```text
my-video.agent-video/
  spec.json
  hyperframes/*.tsx
  assets/**
  compiled-plan.json  # renderer-generated after compile
```

The agent is the director. It writes narration, declares repo refs/assets,
chooses music/caption policy, and may create deterministic hyperframe code for
richer visuals. The renderer remains the executor: it validates, resolves
refs/assets, measures TTS, compiles exact timings, renders, and muxes. Do not
hardcode a new renderer scene template when a smart agent can compose a one-off
hyperframe from safe primitives. See `docs/bundle-v2.md`.

Put shared video style in `meta.theme`, not scattered through component code.
Run `agent-video bundle themes` to list the designed presets with their full
color tokens, then pick ONE by mood — this is the main design decision and a
single word restyles every frame, glow, chip, and chart:

- `ink` (default): near-black slate, iris accent, magenta glow — technical, premium
- `aurora`: deep sea green + teal — calm systems energy
- `ember`: warm charcoal + amber — launch-video warmth
- `orchid`: plum black + magenta — bold creator energy
- `graphite`: pure monochrome — austere, editorial
- `paper`: light warm paper + cobalt — daylight, docs-like
- `neutral`: quiet gray-blue dark — product walkthroughs
- `agent-dark`: legacy navy-and-periwinkle default, kept for existing bundles

Prefer `{ "preset": "<id>" }` alone. Add small semantic overrides only when the
user has a brand color: `{ "preset": "ink", "colors": { "accent": "#ff5d5d" } }`.
Semantic `colors` define fg/bg/surface/accent/accent2/status/caption tokens
(`accent2` drives the background glow), and `typography` defines `display`,
`body`, and `mono` roles. Presets already pass the contrast gates; overrides are
re-validated at `bundle validate`. Hyperframe components receive a fully
resolved `ctx.theme` and the renderer uses it for built-in component drawing.
Do not use Tailwind-style `className` strings or CSS font stacks in hyperframes.
`Stage tone` is a local treatment hint, not the video palette selector; use
`meta.theme.preset` for light/dark/neutral.

For hyperframes, declare resource ports once in the hyperframe module's literal
`inputs` object. In `spec.json`, use `visual.inputs` only to map those ports to
scene refs, bundle assets, named ranges, or direct time refs such as `line:l2`.
Keep visual copy/layout settings in `visual.props`.

Reusable components live in `@agent-video/hyperframes`. Run
`agent-video bundle components` before writing a custom hyperframe. Think in
three layers:

- host primitives: `Stage`, `Stack`, `Grid`, `Text`, `Panel`, `Badge`, `Meter`,
  `Callout`, `BigStat`, `Checklist`, `Quote`, `FunctionPlot`, `Formula`,
  `TravelPath`, `TimelineRail`, `SystemMap`, captions
- media primitives: `CodeRef`, `DiffRef`, `Chart`, `ImageAsset`
- story components: `DecisionGrid`, `SignalWall`, `LaneStack`, `ProofLadder`,
  `StatusRail`, `PhaseBanner`, `CaptionDeck`, `StatRow`, `CompareSplit`

Reach for the showcase blocks before hand-building equivalents: `BigStat` /
`StatRow` for metric moments ("183 tests"), `Checklist` for shipped/todo lists
with drawn state circles, `CompareSplit` for before/after stories, `Quote`
for pull-quotes, `TravelPath` for animated journeys (a plane arcing
Prague → SF), and for education/math videos `FunctionPlot` (numeric y = f(x)
curves with a descent path, tangent, and marker ball) plus `Formula`
(θ ← θ − α · ∇J(θ) with accent-highlighted terms — full math glyph coverage). They are theme-aware and read like
designed slides with zero styling effort.

This is video, not a slideshow: hyperframe scenes render every frame with a
deterministic motion clock. `ctx.scene.progress` and `ctx.range(...)` advance
continuously — map motion to narration with range inputs
(`inputs: { flight: "line:l1" }` then `progress={ctx.range("flight").progress}`).
The renderer adds automatic entrances, chart growth, count-ups, and word-pop
captions on top; stills (workshop, thumbnails) always show end states, so
compose for the finished frame and let timing bring it alive.

The command returns structured JSON with import names, layers, prop hints, and
JSX examples. Use those examples as the default starting point for custom
hyperframes.

Starter templates are complete examples, not the main reuse layer. Run
`agent-video bundle templates` when a full starter is close to the story, then
copy it into the bundle and adapt its `propsSchema`, `inputs`, and
`render(ctx)`. Use `KineticCaption` or lower-third components for TikTok-style
visual text. Canonical subtitles still come from exact narration text. If the
spec uses burn-in captions, omit `KineticCaption` unless you intentionally want
a second visual caption layer.

Visual pacing rule for bundle v2: **one focal visual per narration line**. Do
not put the system map, chart, live code, callout, and captions all on one
frame. Great agent videos feel fast because the focus changes beat-by-beat, not
because every possible evidence object is visible at once. If a frame has more
than one primary panel, split it into another narration line, optional beat, or
scene.

**Titles are chapter openers, not scene furniture.** This is video, not a
slide deck: narration already carries the words, so most scenes should let the
focal visual own the whole frame. Use `PhaseBanner`/`LowerThird` on the opening
scene (and at a real chapter turn); after that, prefer a bare `FunctionPlot`,
`Formula`, `DiffRef`, or chart full-bleed. If every scene in your spec starts
with an eyebrow + title, you are making a presentation — delete the headers.

Hyperframe scenes render every frame at the spec fps: `ctx.scene.lineIndex`
and `ctx.scene.lineId` pick the line-state visual, while `ctx.scene.progress`,
`ctx.time`, and `ctx.range()` advance continuously for smooth motion.
`bundle render --stills` holds one frame per line when you need a fast draft.
Hyperframes are trusted local code with static policy lint, not a hostile-code
sandbox: import only `@agent-video/hyperframes` and declare all
repo/assets/ranges in `spec.json`.

Bundle commands:

- `agent-video bundle schema`
- `agent-video bundle validate <bundle-dir>`
- `agent-video bundle inspect <bundle-dir>`
- `agent-video bundle components`
- `agent-video bundle templates`
- `agent-video bundle workshop <bundle-dir> [--out DIR] [--aspect 16:9,9:16]`
- `agent-video bundle compile <bundle-dir>`
- `agent-video bundle render <bundle-dir> [--out DIR] [--aspect 16:9,9:16]`

## Workflow

1. **Gather context** from the real repo: `git diff`, `git log`, changed
   `file:line` ranges, PR/commit messages, test output, README.
2. **Author `spec.json`**: an ordered list of scenes, each with `narration`.
   Keep narration to ~1–2 sentences per scene; the video paces itself to the
   spoken audio (`"duration": "auto"`).
   - **For visual clarity**, make every narration line answer: what is the one
     thing on screen right now? One line can show a map, the next can cut to
     code, the next can cut to data. Avoid dashboard-like frames where multiple
     major panels compete for attention.
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

For bundle videos, run `agent-video bundle workshop <bundle-dir>` before the
final render when visual polish matters. It renders real scene/line/aspect PNGs
through the same hyperframe canvas renderer, producing a static gallery that is
much faster to review than a full MP4.

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
