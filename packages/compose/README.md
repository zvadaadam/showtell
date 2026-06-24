# @agent-video/compose

Mode B rendering: turn a spec scene into a still PNG frame, per aspect ratio, with
[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) + [Shiki](https://shiki.style).
Deterministic (pinned, embedded fonts; no wall-clock/RNG).

- `renderSceneToPng(scene, opts)` — one scene → PNG (+ the resolved live bytes for code/diff).
- `scenes/{title,code,diff,talking-points,chart}.ts` — one drawer per scene kind.
- `dims`, `theme`, `draw`, `fonts`, `highlight` — shared layout, palette, and helpers.

Internal package of [agent-video](../../README.md).
