# @showtell/compose

Mode B rendering: turn a spec scene or executed hyperframe tree into a still
PNG frame, per aspect ratio, with
[@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) +
[Shiki](https://shiki.style). Deterministic (pinned, embedded fonts; no
wall-clock/RNG).

- `renderSceneToPng(scene, opts)` — one scene → PNG (+ the resolved live bytes for code/diff).
- `renderHyperframeElementToPng(element, opts)` — executed hyperframe tree → PNG.
- `primitives/{code,diff,chart}.ts` — reusable low-level drawers for `CodeRef`,
  `DiffRef`, and `Chart`.
- `scenes/{title,talking-points}.ts` — full-scene presenters for built-in visuals.
- `dims`, `theme`, `draw`, `fonts`, `highlight` — shared layout, palette, and helpers.

Internal package of [showtell](../../README.md).
