---
name: showtell
description: >-
  Make polished narrated videos with Showtell, especially repo-aware explainers,
  PR walkthroughs, demos, launches, lessons, reports, and visual stories. Use
  bundle v3 HTML/CSS/GSAP for crafted motion and simple specs for quick videos.
---

# Showtell

Showtell is the deterministic production shell for videos authored by smart agents. The agent directs the visual world; Showtell measures narration, resolves live repo/data inputs, seeks exact browser frames, adds captions/presenter chrome, and encodes the MP4.

The crafted-video surface is **bundle v3**: normal HTML/CSS plus one paused GSAP timeline.

## Non-negotiable contract

Author intent and visuals, never execution machinery.

- Never write ffmpeg, frame loops, `compiled-plan.json`, or exact audio timing.
- Never paste repo source into props/HTML. Declare `code`/`diff` refs; Showtell reads the live bytes.
- Keep narration in `spec.json`; use measured automatic duration.
- Use only declared refs, assets, props, and semantic ranges in custom visuals.
- A v3 visual has one paused `gsap.timeline`; Showtell seeks it at every exact encoded timestamp.
- No network, timers, wall clock, CSS animation/transition, Web Animations/SMIL, Web Crypto randomness, dynamic import, or `eval`.

## Choose the path

Use a simple spec for a fast factual walkthrough made from declarative title, code, diff, talking-points, chart, or screencap scenes. Showtell compiles its designed scenes to trusted internal browser HyperFrames, so this is simpler authoring—not a second visual runtime.

In a v3 bundle, use `visual.kind: "web"` for every designed scene. Start with renderer-provided components such as `<st-code>`, `<st-diff>`, and `<st-chart>` when a scene is straightforward; compose them with normal HTML/CSS/GSAP when it needs a custom browser world. Use `visual.kind: "screencap"` only to play recorded capture media with optional clip and playback controls.

Use bundle v3 whenever quality or choreography matters: custom spatial explanations, line-synced transformations, mixed repo/data/image evidence, responsive composition, bespoke typography, or anything the user calls “beautiful,” “motion-designed,” or “not slides.”

Start v3 discovery with:

```bash
showtell bundle themes
showtell bundle components
showtell bundle templates
showtell bundle runtime
showtell bundle schema
```

These are JSON APIs. Read their current output instead of guessing runtime/component details.

## Crafted-video creative gate

Before writing HTML, state these four decisions in a short local brief:

1. **Viewer message** — one sentence: what should the viewer understand or feel?
2. **Visual world** — one concrete metaphor such as a signal path, assembly line, folding map, orbit, or instrument panel.
3. **Identity** — one `meta.theme.preset` and an intentional font pairing. For distinctive offline-safe type, prefer League Gothic display with Space Mono or JetBrains Mono technical copy.
4. **Depth plan** — background atmosphere, one midground focal visual, and foreground structure/metadata.

For a multi-line piece, add one focal visual and one motion verb per narration line: trace, assemble, route, compare, fold, reveal, lock, settle. The value/message must land by the second line; implementation evidence comes after it.

Do not start from colors and cards. Start from the metaphor and the transformation.

## Visual quality rules

This is video, not a responsive web page or slide deck.

- One primary idea per narration line. Use cuts/state changes for pace instead of cramming panels together.
- Aim for 8–10 total elements across depth layers: atmosphere, focal content, rules/rails/labels/registration details. Density is not the same as competing focal points.
- Titles are chapter openers, not scene furniture. If every state starts with eyebrow + title, remove most of them.
- Anchor important content to edges/zones. Avoid a centered stack floating on a flat fill.
- Use visible video scale: roughly 64–120px landscape headlines, 28–42px body, 18–24px technical labels.
- Use one accent color with tinted neutrals. Avoid generic cyan/purple gradients, identical card grids, and decoration below compression-visible opacity.
- Give atmosphere finite ambient motion; give entrances varied vectors/eases. Do not send every element from `y: 30, opacity: 0`.
- Build the fully visible hero/end state in CSS first. Add GSAP entrances only after the layout is correct.
- For state changes, overlap outgoing and incoming choreography at the same timestamp. Do not fade to a dead gap between them.

## Bundle v3 shape

```text
my-video.showtell/
  spec.json
  hyperframes/*.html
  assets/**
  compiled-plan.json  # renderer-generated
```

Minimal scene:

```json
{
  "version": 3,
  "meta": {
    "title": "Live bytes, exact frames",
    "fps": 30,
    "aspectRatios": ["16:9", "9:16"],
    "theme": { "preset": "ink" },
    "repo": { "path": ".." }
  },
  "audio": {
    "tts": { "provider": "say" },
    "captions": { "mode": "burn-in", "source": "narration" }
  },
  "scenes": [
    {
      "id": "proof",
      "narration": {
        "lines": [{ "id": "l1", "text": "Showtell reads live source and seeks the visual at exact measured time." }]
      },
      "refs": {
        "source": { "kind": "code", "file": "src/motion.ts", "lineStart": 1, "lineEnd": 20 }
      },
      "visual": {
        "kind": "web",
        "src": "hyperframes/proof.html",
        "props": { "title": "Same input. Same pixels." },
        "inputs": { "source": "source", "reveal": "line:l1" }
      }
    }
  ]
}
```

The HTML declares its static contract:

```html
<script type="application/showtell+json">
  {
    "schemaVersion": 3,
    "propsSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": ["title"],
      "properties": { "title": { "type": "string", "minLength": 1 } }
    },
    "inputs": {
      "source": { "kind": "repo", "refKind": "code" },
      "reveal": { "kind": "range" }
    }
  }
</script>
```

Use `<st-code input="source" reveal-range="reveal"></st-code>` for live code evidence. Do not rebuild source loading or paste a snippet.

## Runtime and motion

Use `window.__showtell`:

```js
const st = window.__showtell;
const reveal = st.range("reveal");
const timeline = gsap.timeline({ paused: true });

timeline.fromTo(
  ".hero",
  { opacity: 0, y: 72, scale: 0.94 },
  { opacity: 1, y: 0, scale: 1, duration: 0.72, ease: "expo.out" },
  reveal.startSec,
);
timeline.fromTo(
  ".signal-fill",
  { scaleX: 0 },
  { scaleX: 1, duration: reveal.durationSec, ease: "none" },
  reveal.startSec,
);

st.timeline = timeline;
```

Available state includes `st.props`, resolved `st.inputs`, `st.viewport`, `st.scene`, `st.line`, `st.time`, `st.range(name)`, deterministic `st.random(key)`, and `st.safeArea`.

Theme variables include semantic colors/fonts plus `--st-safe-top/right/bottom/left`. Respect those insets so renderer-owned captions and the presenter bubble do not cover the focal visual.

Use responsive CSS and an aspect query:

```css
.world {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.content {
  padding: max(5vw, var(--st-safe-left));
}

@media (max-aspect-ratio: 4 / 5) {
  .content {
    display: grid;
    grid-template-rows: auto 1fr;
    padding-block: 7vw;
    padding-inline: max(7vw, var(--st-safe-left)) max(7vw, var(--st-safe-right));
  }
}
```

Recompose 9:16 vertically; do not shrink a fixed 1920×1080 layout.

## Production loop

For v3, use this order:

```bash
showtell bundle validate my-video.showtell
showtell bundle inspect my-video.showtell
showtell bundle workshop my-video.showtell --out .showtell/workshop --aspect 16:9,9:16
showtell bundle review my-video.showtell --out .showtell/review --aspect 16:9,9:16 --samples 5
showtell bundle render my-video.showtell --out .showtell/out --aspect 16:9,9:16
```

Workshop, review, and render compile automatically. Run `bundle compile` directly only when you need to inspect `compiled-plan.json` without rendering. Use workshop to judge held layout, hierarchy, overflow, captions, and orientation. Use review to judge motion; its frames are sampled at the exact timestamps the encoder uses. A valid spec is not a quality proof.

Iterate until all are true:

- every narration claim is visibly supported;
- each line expected to move changes across its review samples;
- the focal visual remains readable with captions/presenter enabled;
- code/diff pixels come from declared live refs;
- 16:9 and 9:16 both feel composed;
- no static “slide furniture” repeats without narrative purpose;
- final duration matches the compiled plan and the output file exists.

Open the final MP4 for the user when they ask to see it. Report the MP4 path, review gallery, and any relevant deterministic/live-ref verification.

## Simple-spec loop

For a quick declarative video (compiled internally to browser HyperFrames):

1. Gather real repo evidence (`git diff`, changed `file:line` ranges, test output).
2. Author a small spec with narration matching the actual frame.
3. Run `showtell validate`.
4. Run `showtell render --frames-only` and inspect the PNGs.
5. Run the final render or `showtell preview` if the user wants the watch player.

Keep code excerpts focused (roughly 6–25 lines) and point `focus` at narrated lines. Chart values are authored data; Showtell does not invent repository statistics.
