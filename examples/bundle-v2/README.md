# Bundle v2 example

This directory is a runnable example for the v2 bundle contract in
`docs/bundle-v2.md`. Use `agent-video bundle inspect examples/bundle-v2` to see
the hyperframe contracts and implicit beats before compiling or rendering. Use
`agent-video bundle templates` to discover reusable starters from
`@agent-video/hyperframes`.

The example is intentionally structured like a future real bundle:

- `spec.json` declares narration, repo refs, assets, captions, music, and
  hyperframe entry points. Per-scene `visual.inputs` maps hyperframe ports to
  repo refs, assets, or time spans.
- `hyperframes/*.tsx` are agent-authored visual programs. Their literal
  `inputs` objects define the resource contract that bundle validation checks.
  They import reusable authoring primitives such as `CodeRef`,
  `CaptionSafeArea`, and `KineticCaption` from `@agent-video/hyperframes`.
- `assets/data/metrics.json` is a declared data asset.
- `assets/audio/bed.wav` is a tiny silent placeholder music bed so future asset
  probing can verify duration, hashing, looping, and ducking behavior.
