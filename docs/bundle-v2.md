# Bundle v2: agent-authored hyperframe videos

Status: implemented runtime. The repo now supports `agent-video bundle
validate|inspect|compile|render|schema` for a v2 source bundle. The current renderer
validates hyperframe modules, extracts their literal input contracts, executes
their pure `render(ctx)` function, and renders the returned tree with
deterministic map, code, diff, chart, caption, and image primitives.

## Summary

Bundle v2 changes the authoring unit from one scene JSON file to a source
bundle:

```text
my-video.agent-video/
  spec.json
  hyperframes/
    intro.tsx
    product-system.tsx
    proof-chart.tsx
  assets/
    audio/bed.wav
    data/metrics.json
    images/demo.png
```

After `agent-video bundle compile` or `agent-video bundle render`, the renderer
adds generated files:

```text
my-video.agent-video/
  compiled-plan.json
  out/
```

The agent is the director. It gathers material, writes narration, chooses repo
refs, designs the edit, creates hyperframe code, and declares music/caption
policy. The renderer is a deterministic executor. It validates the bundle,
resolves live repo bytes and assets, synthesizes and measures narration,
compiles exact timings, renders frames, and muxes audio/video.

## Why not one giant JSON timeline?

Agents are strong at story, source selection, and writing code. They are weak at
fragile frame math. A giant JSON timeline pushes visual creativity into tiny
configuration fields and makes good video feel like filling a form.

Bundle v2 keeps JSON for orchestration and moves visual behavior into
hyperframe code:

- `spec.json` answers: what are the scenes, source IDs, assets, narration,
  captions, music, hyperframe entry points, and per-scene input mappings?
- `hyperframes/*.tsx` answers: how should each narration-line state look?
- `compiled-plan.json` answers: what exact frames, timestamps, hashes, and
  output paths did the renderer produce?

## Visual Density

Bundle v2 videos should be dynamic without becoming dashboards. The default
authoring rule is **one focal visual per narration line**:

- Show one primary thing at a time: system map, live code, chart, screenshot, or
  callout.
- Use line-to-line cuts to create pace. Do not make one frame carry every asset
  just because the bundle declares every asset.
- Captions count as a visual layer. Leave enough empty space around them.
- If the user needs to understand three evidence objects, author three
  narration lines or beats instead of one crowded composition.

Hyperframes can create custom layouts when a specific story needs them; the
burden is on the hyperframe to preserve a clear visual hierarchy. The renderer
does not infer panels from props or rotate focus for the agent.

## CLI

All bundle commands are non-interactive and emit structured JSON:

```bash
agent-video bundle schema
agent-video bundle validate examples/bundle-v2
agent-video bundle inspect examples/bundle-v2
agent-video bundle components
agent-video bundle templates
agent-video bundle workshop examples/bundle-v2 --out .agent-video/workshop --aspect 16:9
agent-video bundle compile examples/bundle-v2
agent-video bundle render examples/bundle-v2 --out .agent-video/bundle-v2 --aspect 16:9,9:16
```

`bundle inspect` validates first, then prints a structured authoring map:
scenes, narration lines, implicit/authored beats, refs, ranges, assets,
hyperframe props schemas, and required input ports. Run it before compile when
an agent needs to see what a hyperframe expects without reading the TSX by hand.
`bundle components` lists reusable imports from `@agent-video/hyperframes`.
Agents should use this before authoring a custom hyperframe. `bundle templates`
lists complete starters to copy only when the whole story shape is close.
`bundle workshop` compiles the real bundle and renders every scene/line/aspect
as PNGs in a static HTML gallery, so agents and humans can review hierarchy,
caption safety, and component polish before rendering a full MP4.

`bundle compile` performs the timing pass: it validates the authored bundle,
synthesizes and measures per-line narration, resolves beat/range/music spans,
hashes declared assets, resolves live repo refs, and writes `compiled-plan.json`.
`bundle render` compiles first, then emits MP4s, thumbnails, caption sidecars,
and burn-in captions when requested.

## Non-negotiable contract

- For simple videos, agents may author only `spec.json`.
- For bundle videos, agents may author `spec.json`, `hyperframes/*.tsx`, and
  bundled assets.
- Agents never author `compiled-plan.json`, ffmpeg commands, frame manifests, or
  pasted repo source.
- Code and diff material is declared as repo references and resolved by the
  renderer.
- Hyperframes are trusted local code plus static policy lint, not a hostile-code
  sandbox. They must not read files, run subprocesses, call network APIs, play
  audio, or inspect environment variables; declare every resource in `spec.json`.
- Current bundle rendering samples one still frame per narration line. Use
  `ctx.scene.progress`, `ctx.range()`, and `ctx.viewport` to choose line-state
  visuals and responsive layouts; use line-to-line cuts for pace.
- Determinism means: same authored bundle, renderer/runtime version, resolved
  repo bytes, assets, and cached TTS audio produce the same MP4.

## Path rules

The bundle root is the directory containing `spec.json`.

- `assets.*.src` and `visual.src` are bundle-relative paths.
- `meta.repo.path` is also bundle-relative unless absolute. For a bundle stored
  under the repo root, use `".."`; for `examples/bundle-v2`, use `"../.."`.
- Repo ref `file` paths are repo-relative after `meta.repo.path` resolves.
- Path escapes outside the bundle are rejected for assets and hyperframes.
- Repo paths may point outside the bundle only through `meta.repo.path`.

## Author-facing spec

```jsonc
{
  "$schema": "https://agent-video.dev/schemas/bundle-v2.json",
  "version": 2,
  "meta": {
    "title": "PR walkthrough",
    "fps": 30,
    "aspectRatios": ["16:9", "9:16"],
    "repo": { "path": "..", "baseRef": "main", "headRef": "HEAD" },
  },
  "assets": {
    "bed": { "type": "audio", "src": "assets/audio/bed.wav" },
    "metrics": { "type": "data", "src": "assets/data/metrics.json" },
  },
  "audio": {
    "tts": { "provider": "say" },
    "captions": { "mode": "burn-in", "source": "narration" },
    "music": [
      {
        "id": "bed",
        "asset": "bed",
        "range": { "from": "scene:proof@start", "to": "scene:proof@end" },
        "loop": true,
        "gainDb": -28,
        "duckUnderNarration": true,
        "fadeInMs": 800,
        "fadeOutMs": 1400,
      },
    ],
  },
  "scenes": [
    {
      "id": "proof",
      "narration": {
        "lines": [
          { "id": "l1", "text": "This change adds a retry guard before the webhook mutates state." },
          { "id": "l2", "text": "The key detail is the atomic check on line 18." },
        ],
      },
      "refs": {
        "store": {
          "kind": "code",
          "file": "src/payments/idempotencyStore.ts",
          "lineStart": 12,
          "lineEnd": 30,
          "focus": [18],
        },
      },
      "visual": {
        "kind": "hyperframe",
        "src": "hyperframes/product-system.tsx",
        "export": "default",
        "inputs": {
          "source": "store",
          "metrics": "metrics",
          "reveal": "line:l2",
        },
        "props": {
          "title": "Retry guard",
        },
      },
    },
  ],
}
```

Built-ins remain available for migration and simple videos:

```jsonc
{
  "id": "quick-diff",
  "narration": { "lines": [{ "id": "l1", "text": "This diff shows the guard." }] },
  "refs": {
    "webhookDiff": { "kind": "diff", "file": "src/payments/webhook.ts", "ref": "main..HEAD" },
  },
  "visual": { "kind": "builtin", "name": "diff", "ref": "webhookDiff" },
}
```

## Spec field contract

This is the normative v2 shape. `agent-video bundle schema` prints the generated
JSON Schema.

Top level:

- `version`: required literal `2`.
- `$schema`: optional string.
- `meta`: required object.
- `assets`: optional object keyed by asset ID.
- `audio`: optional object.
- `scenes`: required non-empty array.

IDs:

- Asset IDs, scene IDs, line IDs, beat IDs, anchor IDs, and range IDs use
  `^[A-Za-z][A-Za-z0-9_-]{0,63}$`.
- IDs are unique within their scope. Scene IDs are global. Asset IDs are global.
  Line, beat, anchor, range, and ref IDs are scene-local.

`meta`:

- `title`: required non-empty string.
- `fps`: optional integer `1..120`, default `30`.
- `aspectRatios`: optional array of `"16:9" | "9:16" | "1:1"`, default
  `["16:9"]`.
- `repo.path`: optional string, default `".."`, resolved by the path rules
  above.
- `repo.baseRef` and `repo.headRef`: optional git refs used by defaults and
  diagnostics.
- `theme`: optional shared brand system for all hyperframes in the video. It is
  intentionally semantic, not a CSS dump. Prefer a preset plus small overrides:
  `{ "preset"?: "agent-dark" | "paper" | "neutral", "colors"?: { "fg"?,
"bg"?, "subtle"?, "accent"?, "success"?, "warning"?, "surface"?,
"border"?, "captionBg"?, "captionFg"? }, "typography"?: { "display"?,
"body"?, "mono"? } }`.
  `mode?: "dark" | "paper" | "neutral"` is accepted as a tone alias, but
  `preset` is the primary authoring field. The renderer resolves the recipe
  into a complete `ctx.theme` before hyperframes run, so component code can read
  every theme token without fallbacks. Colors are strict 6-digit hex values.
  Typography values are plain registered font family names; the renderer ships
  deterministic `Inter`, `Inter Bold`, and `JetBrains Mono` today.
  Foreground/background and caption color pairs must be readable; weak accent
  contrast is reported as a warning.
- `Stage tone` inside hyperframe TSX is only a local treatment/fallback hint.
  Use `meta.theme.preset` for the video's light/dark/neutral palette.

`assets` values:

- Audio: `{ "type": "audio", "src": string }`.
- Data: `{ "type": "data", "src": string }`; JSON files are parsed and exposed
  through `ctx.asset(id).data`.
- Image: `{ "type": "image", "src": string }`.
- Asset files must be bundle-relative, bounded, non-symlink files.

`audio`:

- `tts.provider`: `"say" | "openai" | "replicate" | "elevenlabs"`.
- `captions.mode`: `"off" | "sidecar" | "burn-in" | "sidecar-and-burn-in"`,
  default `"off"`.
- `captions.source`: only `"narration"` in v2.
- `music`: optional array of music beds. Each item requires `id`, `asset`, and
  `range`, with optional `loop`, `gainDb`, `duckUnderNarration`, `fadeInMs`, and
  `fadeOutMs`.

Scene values:

- `id`: required scene ID.
- `duration`: optional, defaults to `"auto"` in v2. Numeric scene durations can be added
  later only if they validate against measured narration duration.
- `narration.lines`: required non-empty ordered array. Each line has `id`,
  and `text`. `text` is both the spoken TTS source and the canonical subtitle
  text.
- `refs`: optional object of scene-local repo refs. `code` refs require `file`
  and optional `lineStart`, `lineEnd`, `ref`, `focus`, `language`. `diff` refs
  require `file` and `ref`.
- `beats`: optional ordered array. If omitted, the renderer creates one
  implicit beat per narration line. Authored beats have `id` and `lines`; beat
  line IDs must be contiguous in narration order.
- `anchors`: optional array of `{ "id": string, "at": TimePointRef }`.
- `ranges`: optional object whose values are either `TimeSpanRef` strings or
  `{ "from": TimePointRef, "to": TimePointRef }`.
- `visual`: required. Use `{ "kind": "hyperframe", "src": string, "export":
"default", "inputs": object, "props": object }` or `{ "kind": "builtin",
"name": ..., ... }`.

Strictness:

- Unknown keys fail validation.
- Current slice: hyperframes must use the canonical default-export shape and
  literal `propsSchema` + `inputs` constants. Validation statically extracts
  those constants without executing `render(ctx)`.
- `visual.inputs` maps hyperframe input ports to scene refs, top-level assets,
  named ranges, or direct `TimeSpanRef` values.

## Timing model

Scenes are narration chapters. Lines are the TTS and subtitle unit. Beats attach
visual timing to one or more narration lines when an explicit grouping is
useful; otherwise each line becomes an implicit beat. Anchors are named points
inside a scene, line, or beat. Ranges are named spans used by hyperframes and
music.

Bundle v2 requires per-line TTS. Scene audio is the concatenation of line audio
in narration order, plus a deterministic 600 ms scene tail unless a later schema
adds an explicit `tailMs`. There is no implicit gap between lines. A beat spans
from the start of its first line to the end of its last line. Lines in a beat
must be contiguous and ordered.

Frame rounding is renderer-owned:

- `startFrame = floor(startMs * fps / 1000)`
- `endFrame = ceil(endMs * fps / 1000)`
- frame ranges are `[startFrame, endFrame)`
- output duration is derived from the compiled frame count

## Time reference grammar

Use stable IDs instead of scene indexes.

`TimeSpanRef` resolves to a span:

```text
video
scene:<sceneId>
line:<sceneId>/<lineId>
beat:<sceneId>/<beatId>
range:<sceneId>/<rangeId>
```

`TimePointRef` resolves to a point:

```text
video@start
video@end
scene:<sceneId>@start
scene:<sceneId>@end
line:<sceneId>/<lineId>@start
line:<sceneId>/<lineId>@end
beat:<sceneId>/<beatId>@start
beat:<sceneId>/<beatId>@end
beat:<sceneId>/<beatId>@0.35
range:<sceneId>/<rangeId>@start
range:<sceneId>/<rangeId>@end
anchor:<sceneId>/<anchorId>
```

Scene-local shorthand is allowed inside that scene's `ranges` and hyperframe
inputs: `line:l2`, `beat:proof`, and `range:codeReveal` mean the current
scene's line, beat, or range.

Authoring rules:

- A string range value must be a `TimeSpanRef`.
- A `{ "from": ..., "to": ... }` range must use `TimePointRef` endpoints.
- Fractional refs like `beat:proof/atomic-check@0.25` are points inside the
  compiled beat span. Fractions are clamped to `[0, 1]` and resolved in
  milliseconds before frame rounding.
- Hyperframe range inputs first resolve current-scene named ranges, then direct
  `TimeSpanRef` strings such as `line:l2`.

## Hyperframe runtime

Each hyperframe is agent-authored code with a narrow deterministic interface.
The canonical module shape is a default object:

```ts
import type { HyperframeContext, JsonSchema } from "@agent-video/hyperframes";

export interface HyperframeModule<Props> {
  schemaVersion: 1;
  propsSchema: JsonSchema;
  inputs?: HyperframeInputs;
  render(ctx: HyperframeContext<Props>): JSX.Element;
}

interface Props {
  title: string;
}

type HyperframeInput =
  | { kind: "repo"; refKind?: "code" | "diff"; optional?: boolean }
  | { kind: "asset"; assetType?: "audio" | "data" | "image"; optional?: boolean }
  | { kind: "range"; optional?: boolean };

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string" },
  },
};

const inputs = {
  source: { kind: "repo", refKind: "code" },
  metrics: { kind: "asset", assetType: "data" },
  reveal: { kind: "range" },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const source = ctx.repo("source");
  const metrics = ctx.asset("metrics");
  const reveal = ctx.range("reveal");
  return null;
}

export default { schemaVersion: 1, propsSchema, inputs, render } satisfies HyperframeModule<Props>;
```

`inputs` is machine-readable validation metadata. It lives in the hyperframe
module; do not copy it into `spec.json`. The spec maps those ports through
`visual.inputs`. Supported input forms:

```ts
type HyperframeInput =
  | { kind: "repo"; refKind?: "code" | "diff"; optional?: boolean }
  | { kind: "asset"; assetType?: "audio" | "data" | "image"; optional?: boolean }
  | { kind: "range"; optional?: boolean };

type HyperframeInputs = Record<string, HyperframeInput>;
```

Input keys are stable resource ports. If `inputs.source` says `{ kind: "repo",
refKind: "code" }`, `visual.inputs.source` must name a scene-local `refs` entry
whose resolved kind is `code`. Bad mappings fail validation with the
`visual.inputs.*` path, before frame rendering.

The renderer calls `render(ctx)` once per narration line with this context:

```ts
interface HyperframeContext<Props> {
  props: Props;
  viewport: { width: number; height: number; aspectRatio: "16:9" | "9:16" | "1:1"; fps: number };
  scene: {
    id: string;
    index: number;
    startMs: number;
    durationMs: number;
    progress: number;
    lineIndex: number;
    lineCount: number;
    lineId?: string;
  };
  time: { absoluteMs: number; sceneMs: number; frame: number };
  range(idOrRef: string): { active: boolean; progress: number; startMs: number; endMs: number; durationMs: number };
  repo(refId: string): ResolvedCode | ResolvedDiff;
  asset(assetId: string): ResolvedAsset;
  captions: { safeArea: { top: number; right: number; bottom: number; left: number }; activeCue?: CaptionCue };
  theme: HyperframeTheme;
  random(key: string): number;
}
```

Resolved input shapes:

```ts
interface ResolvedCode {
  kind: "code";
  id: string;
  file: string;
  ref?: string;
  lineStart?: number;
  lineEnd?: number;
  focus?: number[];
  language?: string;
  text: string;
  sha256: string;
}

interface ResolvedDiff {
  kind: "diff";
  id: string;
  file: string;
  ref: string;
  text: string;
  added: number;
  removed: number;
  sha256: string;
}

type ResolvedAsset =
  | { type: "data"; id: string; src: string; sha256: string; data: unknown }
  | { type: "audio"; id: string; src: string; sha256: string; durationMs: number; path: string }
  | { type: "image"; id: string; src: string; sha256: string; width: number; height: number; path: string };

interface CaptionCue {
  sceneId: string;
  lineId: string;
  text: string;
  startMs: number;
  endMs: number;
}
```

The `@agent-video/hyperframes` package is the reusable authoring kit. It
provides type definitions, deterministic host primitives, media primitives,
story components, and starter templates. The renderer executes `render(ctx)`
and then draws the returned component tree through trusted compose primitives.

Think in three layers:

- **Host primitives**: stable renderer-known atoms such as `Stage`, `Stack`,
  `Grid`, `Text`, `Panel`, `Badge`, `Divider`, `Meter`, `Callout`,
  `LowerThird`, `TimelineRail`, `SystemMap`, `CaptionSafeArea`, and
  `KineticCaption`.
- **Media primitives**: trusted live-byte/data renderers: `CodeRef`, `DiffRef`,
  `Chart`, and `ImageAsset`.
- **Story components**: SDK-only function components that compose host/media
  primitives, such as `DecisionGrid`, `SignalWall`, `LaneStack`,
  `ProofLadder`, `StatusRail`, `PhaseBanner`, and `CaptionDeck`.

Run this before authoring custom hyperframes:

```bash
agent-video bundle components
```

The command returns structured JSON with component import names, layer
(`host`, `story`, or `media`), descriptions, best-fit use cases,
required/common props, and copyable JSX examples.

Minimum primitive behavior:

- `Stage` owns the background and safe viewport.
- `Stack` supports `direction`, `gap`, and `grow`.
- `Text` supports `variant`.
- `Panel`, `Badge`, `Divider`, and `Meter` provide small visual atoms for
  component authors.
- `CodeRef` accepts `source: ResolvedCode`, `focus`, `reveal`, and `maxLines`.
- `DiffRef` accepts `source: ResolvedDiff`, `focus`, and `reveal`.
- `Chart` accepts parsed data assets or arrays, plus `type`, `x`, `y`, `title`,
  and `reveal`.
- `CaptionSafeArea` reserves the renderer's burn-in caption space.
- `KineticCaption` renders visual captions from the active narration cue. It is
  not the canonical subtitle stream; SRT/VTT captions still come from
  `narration.lines[].text`. If `audio.captions.mode` burns captions into the
  video, omit `KineticCaption` unless you intentionally want a second visual
  caption layer.
- Story components cover common reusable video structures without making the
  renderer product-specific.

Primitive prop contracts:

```ts
type Tone = "paper" | "dark" | "neutral";
type Gap = "xs" | "sm" | "md" | "lg" | "xl";
type Padding = Gap;

interface StageProps {
  tone?: Tone;
  padding?: Padding;
  children?: unknown;
}
interface StackProps {
  direction?: "horizontal" | "vertical";
  gap?: Gap;
  grow?: boolean;
  children?: unknown;
}
interface TextProps {
  variant?: "eyebrow" | "title" | "section" | "body" | "caption";
  children?: unknown;
}
interface PanelProps {
  title?: string;
  subtitle?: string;
  tone?: "default" | "accent" | "success" | "warning";
  padding?: Padding;
  grow?: boolean;
  children?: unknown;
}
interface BadgeProps {
  text: string;
  tone?: "info" | "success" | "warning" | "muted";
}
interface MeterProps {
  label?: string;
  progress?: number;
  value?: number;
  max?: number;
}
interface CodeRefProps {
  source: ResolvedCode;
  focus?: number[];
  reveal?: number;
  maxLines?: number;
}
interface DiffRefProps {
  source: ResolvedDiff;
  focus?: "file" | "changed" | number[];
  reveal?: number;
}
interface ChartProps {
  data: unknown;
  type: "bar" | "line" | "pie";
  x: string;
  y: string;
  title?: string;
  reveal?: number;
}
interface ImageAssetProps {
  asset: Extract<ResolvedAsset, { type: "image" }>;
  fit?: "contain" | "cover";
}
interface CalloutProps {
  text: string;
  tone?: "info" | "success" | "warning";
  when?: boolean;
}
interface CaptionSafeAreaProps {
  children?: unknown;
}
interface KineticCaptionProps {
  source?: "narration";
  mode?: "word-pop" | "karaoke" | "stacked" | "minimal";
  emphasis?: string[];
  maxWords?: number;
  position?: "bottom" | "middle" | "top";
}
```

Story components are normal function components. They do not add new renderer
surface area; they return trees of host/media primitives. Example:

```tsx
return (
  <Stage padding="lg">
    <CaptionSafeArea>
      <Stack direction="vertical" gap="lg" grow>
        <PhaseBanner eyebrow="model" title={ctx.props.title} phase={ctx.scene.lineIndex} />
        {ctx.scene.lineIndex === 0 ? (
          <DecisionGrid options={ctx.props.options} activeIndex={1} />
        ) : (
          <SignalWall items={ctx.props.signals} activeIndex={ctx.scene.lineIndex} />
        )}
      </Stack>
    </CaptionSafeArea>
  </Stage>
);
```

Hyperframes should import only from `@agent-video/hyperframes`. Validation
rejects common nondeterministic or unsafe source patterns before runtime. This
is an agent-authoring policy gate, not a security sandbox for hostile code. The
policy rejects:

- wall-clock APIs such as `Date.now()`, `new Date()`, or `performance.now()`
- unseeded `Math.random()`, `crypto.randomUUID()`, or random UUID helpers
- filesystem, network, subprocess, process, or environment access
- `eval`, `Function`, timers, top-level await, or `import.meta`
- dynamic imports
- package imports other than `@agent-video/hyperframes`
- DOM audio/video playback
- pasted source text for code or diffs

## Hyperframe starter templates

Starter templates are complete examples, not the main reuse layer. Reuse
components first; copy a template when it is close to the full story shape you
need. Templates live in `packages/hyperframes/templates/`, with the
machine-readable registry exported as `hyperframeTemplates` from
`@agent-video/hyperframes`.

```bash
agent-video bundle templates
```

The command returns structured JSON with each template's `id`, source `path`,
best-fit use cases, required input ports, and whether it includes visual
caption components. Agents should inspect `bundle components` first, then copy
a template into `<bundle>/hyperframes/`, rename it for the story, and edit:

- `propsSchema` for the scene-specific copy/settings the agent wants in
  `visual.props`
- `inputs` for resource ports the renderer must validate and resolve
- `render(ctx)` for composition, visual captions, code/chart placement, and
  timing-driven line states

Current starters:

- `code-kinetic-caption`: live repo code plus TikTok-style visual captions.
- `diff-review`: one focused diff, lower-third context, and one optional
  reviewer callout.
- `single-proof`: one chart or metric proof with one takeaway.
- `image-callout`: one screenshot or visual result with restrained callout
  space.
- `system-map-pulse`: a caption-safe process map opener with a timeline rail.
- `proof-chart-code`: chart evidence plus live repo code for deeper product
  explainers. Use it carefully; split into `single-proof` plus
  `code-kinetic-caption` when the frame starts feeling crowded.

Templates are source starters, not renderer presets. This is deliberate: the
renderer exposes safe host/media primitives, the SDK exposes reusable story
components, and the agent owns composition.

## Audio and captions

TTS is derived from `narration.lines[]` and cached per line. Each line produces a
WAV, duration, and cache key. The renderer concatenates line WAVs into scene
audio and records line timing in `compiled-plan.json`.

Captions are renderer-owned. Agents choose mode; the text comes from
`narration.lines[].text` so subtitles match the spoken audio exactly. There is
no separate line-level caption field. Short lower-thirds, beat labels, and
punchy overlay copy belong in hyperframe props or code, not in the canonical
caption stream:

```jsonc
{
  "audio": {
    "captions": { "mode": "sidecar-and-burn-in", "source": "narration" },
  },
  "scenes": [
    {
      "narration": {
        "lines": [{ "id": "l1", "text": "The exact spoken line." }],
      },
      "visual": {
        "kind": "hyperframe",
        "props": { "callouts": ["Shorter on-screen label"] },
      },
    },
  ],
}
```

Burn-in captions are overlaid by the renderer from compiled line timing. The
hyperframe should reserve caption space, but it must not draw the canonical
caption text itself. Sidecar modes currently emit `.srt` paths in the compiled
plan; WebVTT can be added later.

Music is also renderer-owned. It references declared audio assets and semantic
ranges:

```jsonc
{
  "id": "bed",
  "asset": "bed",
  "range": { "from": "scene:intro@start", "to": "scene:proof@end" },
  "loop": true,
  "gainDb": -28,
  "duckUnderNarration": true,
  "fadeInMs": 800,
  "fadeOutMs": 1400,
}
```

The current renderer mixes declared music ranges with loop, gain, fades, and
optional sidechain ducking under narration. Hyperframes never play music or
narration.

## Compiled plan

`compiled-plan.json` is generated by the renderer and never authored by the
agent. It is required after `bundle compile` and after render. It is
the execution ledger:

```jsonc
{
  "version": 1,
  "sourceVersion": 2,
  "specSha256": "sha256...",
  "bundle": { "dir": ".", "repoPath": ".." },
  "meta": {
    "title": "PR walkthrough",
    "fps": 30,
    "aspectRatios": ["16:9", "9:16"],
    "durationMs": 8200,
    "sceneCount": 1,
  },
  "repo": { "path": "..", "commit": "abc123", "branch": "feature/video" },
  "assets": {
    "bed": {
      "type": "audio",
      "src": "assets/audio/bed.wav",
      "path": "assets/audio/bed.wav",
      "sha256": "sha256...",
      "durationMs": 1000,
    },
    "metrics": {
      "type": "data",
      "src": "assets/data/metrics.json",
      "path": "assets/data/metrics.json",
      "sha256": "sha256...",
    },
  },
  "audio": {
    "tts": { "provider": "say" },
    "captions": { "mode": "burn-in", "source": "narration" },
    "music": [{ "id": "bed", "asset": "bed", "startMs": 0, "endMs": 8200, "durationMs": 8200, "gainDb": -28 }],
  },
  "scenes": [
    {
      "index": 0,
      "id": "proof",
      "startMs": 0,
      "endMs": 8200,
      "durationMs": 8200,
      "narration": {
        "lines": [
          {
            "id": "l1",
            "text": "This change adds a retry guard.",
            "startMs": 0,
            "endMs": 4100,
            "durationMs": 4100,
            "ttsCached": true,
          },
          {
            "id": "l2",
            "text": "The key detail is the atomic check.",
            "startMs": 4100,
            "endMs": 7600,
            "durationMs": 3500,
            "ttsCached": true,
          },
        ],
      },
      "beats": {
        "l1": { "lines": ["l1"], "startMs": 0, "endMs": 4100, "durationMs": 4100 },
        "l2": { "lines": ["l2"], "startMs": 4100, "endMs": 7600, "durationMs": 3500 },
      },
      "anchors": {},
      "ranges": {},
      "refs": {
        "store": {
          "kind": "code",
          "file": "src/payments/idempotencyStore.ts",
          "lineStart": 12,
          "lineEnd": 30,
          "sha256": "sha256...",
        },
      },
      "visual": {
        "kind": "hyperframe",
        "src": "hyperframes/product-system.tsx",
        "props": { "title": "Retry guard" },
        "inputs": { "source": "store", "metrics": "metrics", "reveal": "line:l2" },
      },
      "hyperframe": {
        "src": "hyperframes/product-system.tsx",
        "sourceSha256": "sha256...",
        "propsSha256": "sha256...",
        "inputs": {
          "source": { "kind": "repo", "refKind": "code", "target": "store" },
          "metrics": { "kind": "asset", "assetType": "data", "target": "metrics" },
          "reveal": { "kind": "range", "target": "line:l2", "startMs": 4100, "endMs": 7600, "durationMs": 3500 },
        },
      },
    },
  ],
  "outputs": { "videos": [] },
}
```

No wall-clock `generatedAt` belongs in hash inputs.

## Verification gates

Every CLI and MCP command must return structured JSON. Failures include
`code`, `path`, `message`, and `hint`.

Recommended command surface:

```bash
agent-video bundle schema
agent-video bundle validate my-video.agent-video
agent-video bundle inspect my-video.agent-video
agent-video bundle components
agent-video bundle templates
agent-video bundle workshop my-video.agent-video --out .agent-video/workshop
agent-video bundle compile my-video.agent-video
agent-video bundle render my-video.agent-video --out .agent-video/out
# preview/watch URL support is future work for bundle v2
```

Success shapes:

```jsonc
// agent-video bundle validate my-video.agent-video
{
  "ok": true,
  "stage": "bundle-validate",
  "bundleDir": "my-video.agent-video",
  "sceneCount": 2,
  "assetCount": 2,
  "hyperframes": [{ "path": "hyperframes/product-system.tsx", "export": "default" }],
  "warnings": [],
}
```

```jsonc
// agent-video bundle inspect my-video.agent-video
{
  "ok": true,
  "stage": "bundle-inspect",
  "scenes": [
    {
      "id": "proof",
      "beats": { "source": "implicit-per-line", "items": [{ "id": "l1", "lines": ["l1"] }] },
      "visual": {
        "kind": "hyperframe",
        "src": "hyperframes/product-system.tsx",
        "propsSchema": { "type": "object" },
        "inputs": [
          { "name": "source", "kind": "repo", "required": true, "refKind": "code", "value": "store" },
          { "name": "metrics", "kind": "asset", "required": true, "assetType": "data", "value": "metrics" },
          { "name": "reveal", "kind": "range", "required": true, "value": "line:l2" },
        ],
      },
    },
  ],
  "warnings": [],
}
```

```jsonc
// agent-video bundle compile my-video.agent-video
{
  "ok": true,
  "stage": "bundle-compile",
  "planPath": "my-video.agent-video/compiled-plan.json",
  "durationMs": 8200,
  "sceneCount": 2,
  "assetCount": 2,
  "musicCount": 1,
  "refs": [{ "scene": "proof", "id": "store", "kind": "code", "file": "src/payments/idempotencyStore.ts" }],
  "warnings": [],
}
```

```jsonc
// agent-video bundle render my-video.agent-video --out .agent-video/out
{
  "ok": true,
  "stage": "bundle-render",
  "planPath": "my-video.agent-video/compiled-plan.json",
  "outputs": [
    { "aspectRatio": "16:9", "path": ".agent-video/out/bundle-16x9.mp4", "durationMs": 8200, "captionsBurnedIn": true },
    { "aspectRatio": "9:16", "path": ".agent-video/out/bundle-9x16.mp4", "durationMs": 8200, "captionsBurnedIn": true },
  ],
  "resolvedCode": [{ "scene": 0, "file": "src/payments/idempotencyStore.ts", "sha256": "..." }],
  "warnings": [],
}
```

Validation happens in layers:

1. Bundle shape: source bundle requires `spec.json`; `compiled-plan.json` is
   optional before compile and overwritten by compile.
2. `spec.json` schema: IDs are unique; strict keys; no pasted source fields.
3. Path resolution: bundle paths cannot escape; repo path resolves explicitly.
4. Asset probe: audio/image/data files exist, are bounded, and match declared
   types.
5. Repo refs: all code/diff refs resolve, ranges are legible, and hashes are
   recorded.
6. Narration graph: lines, beats, anchors, and ranges resolve.
7. Hyperframe exports: each module has the expected default export, literal
   `propsSchema`, and literal input contract.
8. Hyperframe policy lint: no banned APIs or imports.
9. Compile: per-line TTS durations, caption cues, music ranges, scene tails, and
   frame ranges produce a deterministic `compiled-plan.json`.
10. Render: all requested aspect ratios produce non-empty MP4s whose durations
    match the compiled plan within one frame.

The minimum "done" check for a bundle implementation is:

```text
validate.ok == true
compile.ok == true
compiled-plan.json has scene, line, beat, hyperframe input, repo ref, asset, caption, music, and output entries
render.ok == true
all outputs exist
each output duration ~= compiled-plan.timeline.durationMs
code/diff hashes in compiled-plan came from live repo refs
hyperframes never accessed undeclared inputs
```

Example error shape:

```json
{
  "ok": false,
  "errors": [
    {
      "code": "UNKNOWN_RANGE_REF",
      "path": "scenes.0.ranges.callout.from",
      "message": "Unknown anchor reference anchor:proof/callout-in.",
      "hint": "Add the anchor to scenes.0.anchors or point the range at an existing beat or line."
    }
  ]
}
```

## Agent authoring guidance

Prefer agent-created hyperframes when the story needs line-state changes,
comparison, staging, or custom visual grammar. Do not hardcode product-specific
templates into the renderer just because one video needs them. The renderer
should expose safe primitives; the agent should compose them.

Use built-in visuals for simple title, code, diff, chart, talking-point, or
screencap scenes. Use hyperframes when a good video needs a custom structure.

Good agents should iterate:

1. Gather repo context and choose evidence.
2. Draft narration lines and scene IDs.
3. Declare refs/assets/music/captions in `spec.json`.
4. Run `bundle components`, import the reusable host/media/story components you
   need, then write hyperframes using only declared inputs. Run
   `bundle templates` only when a full starter is close enough to copy.
5. Validate the bundle.
6. Run `bundle inspect` to verify hyperframe ports, implicit beats, and mapped
   inputs.
7. Compile and inspect the plan for timing/range mistakes.
8. Render a short preview or frame sample.
9. Fix mismatches between narration, captions, and visuals.
