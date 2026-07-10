# Bundle v2 example

This directory is a runnable example for the v2 bundle contract in
`docs/bundle-v2.md`. Use `showtell bundle inspect examples/bundle-v2` to see
the hyperframe contracts and implicit beats before compiling or rendering. Use
`showtell bundle templates` to discover reusable starters from
`@showtell/hyperframes`.

The example is intentionally structured like a future real bundle:

- `spec.json` declares narration, repo refs, assets, captions, music, and
  hyperframe entry points. Per-scene `visual.inputs` maps hyperframe ports to
  repo refs, assets, or time spans.
- `hyperframes/*.tsx` are agent-authored visual programs. Their literal
  `inputs` objects define the resource contract that bundle validation checks.
  They import reusable authoring primitives such as `CodeRef`,
  `CaptionSafeArea`, and `KineticCaption` from `@showtell/hyperframes`.
- `assets/data/metrics.json` is a declared data asset.
- `assets/audio/bed.wav` is a tiny silent placeholder music bed so future asset
  probing can verify duration, hashing, looping, and ducking behavior.
- `meta.presenter` shows the always-on presenter bubble. The bundle only ships
  the avatar (`assets/presenter/avatar.png` — swap in the author's real photo);
  `"model": "Claude"` resolves the badge mark from the marks built into the
  renderer (claude-code, codex, gemini, copilot, cursor, opencode). Set
  `meta.presenter.logo` to a bundle-local SVG/PNG only to override them. The
  ring pulses with measured narration loudness.
