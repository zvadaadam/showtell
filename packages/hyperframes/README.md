# @agent-video/hyperframes

Typed authoring kit for bundle v2 hyperframes.

This package is where reusable hyperframe vocabulary lives: context types,
host/media primitives, story components, `defineHyperframe`, and starter
templates. The renderer validates hyperframe contracts, executes `render(ctx)`,
and draws the returned component tree through trusted compose primitives.

## Use

```bash
agent-video bundle components
agent-video bundle templates
```

Use components first:

- host primitives: `Stage`, `Stack`, `Grid`, `Text`, `Panel`, `Badge`, `Meter`,
  `Callout`, `BigStat`, `Checklist`, `Quote`, `FunctionPlot`, `Formula`, `TravelPath`
- media primitives: `CodeRef`, `DiffRef`, `Chart`, `ImageAsset`
- story components: `DecisionGrid`, `SignalWall`, `LaneStack`, `ProofLadder`,
  `StatusRail`, `PhaseBanner`, `CaptionDeck`, `StatRow`, `CompareSplit`

`agent-video bundle components` returns the same vocabulary as structured JSON
with import names, layers, prop hints, and JSX examples.

Copy a starter from `templates/` only when a full example is close to the
desired story shape, then adapt:

- `propsSchema` for scene-specific settings in `visual.props`
- `inputs` for renderer-resolved resource ports
- `render(ctx)` for layout, visual captions, and timing-driven line states

Current starter examples:

- `code-kinetic-caption`: focused repo code plus visual captions
- `diff-review`: one changed diff with reviewer context
- `single-proof`: one chart or metric proof
- `image-callout`: one screenshot or visual result
- `system-map-pulse`: a process map opener
- `proof-chart-code`: deeper chart-to-code explainer

Canonical subtitles come from exact narration text. Components such as
`KineticCaption` and `LowerThird` are visual layers inside the hyperframe. If
the spec uses burn-in captions, skip `KineticCaption` unless a second visible
caption treatment is deliberate.
