# agent-video — agent guide

**What this is:** "Loom for agents" — a local, repo-aware **motion render engine**. A coding agent authors intent (`spec.json` + hyperframes) and the engine renders every frame on a deterministic motion clock into a short narrated MP4 — animated visualization, not slide generation. Being local is the moat: code/diff visuals reference the repo by `file:line`/git ref and the renderer reads the **live bytes**, so rendered code is always ground-truth.

**The guiding principle: everything is motion.** Layout, themes, blocks, plots, and captions all sit on top of the motion engine (`packages/compose/src/hyperframe/motion.ts` is the clock; `ctx.time`/`ctx.range()` are the authoring surface). When adding or reviewing features, ask how they move, not just how they look — stills are the degenerate case (end states), never the design target.

**Read first:** `docs/bundle-v2.md` for the bundle v2 authoring model, plus `.context/plan/agent-video-goal.md` when present. Progress + gate ledger: `.context/plan/agent-video-progress.md`.

## The contract (never violate)

- For simple videos, the LLM authors a JSON-Schema-validated `spec.json` (`meta` + ordered `scenes[]`, each with `narration`).
- For bundle videos, the LLM may author `spec.json`, `hyperframes/*.tsx`, and declared assets. It still NEVER writes ffmpeg, frame math, pasted repo source, or `compiled-plan.json`.
- `code`/`diff` material carries repo **references** (`file`, `lineStart/End`, git `ref`), never pasted code.
- Narration uses `duration: "auto"` → the renderer is **two-pass** (synthesize TTS → measure with ffprobe → lay out visuals so audio/visuals stay synced).
- Deterministic: same spec → same mp4. No `Date.now()` / unseeded `Math.random()` in render components. Content-hash cache; TTS cached per narration line.

## Bundle v2 direction

Bundle v2 is a **bundle**, not a giant JSON timeline:

```text
my-video.agent-video/
  spec.json
  hyperframes/*.tsx
  assets/**
  compiled-plan.json  # renderer-generated after compile
```

- `spec.json` stays the orchestration contract: metadata, narration, repo refs, assets, captions, music, scenes, optional beats/ranges, hyperframe entry points, and `visual.inputs` mappings.
- Shared video style belongs in `meta.theme`: choose a semantic `preset` by mood (`ink` is the default; run `bundle themes` for all eight), then override only needed `colors`/`typography`/`chart` tokens. Do not hardcode brand colors or fonts independently in every hyperframe unless the frame intentionally breaks the system; do not use Tailwind-style class strings.
- `hyperframes/*.tsx` are agent-authored deterministic visual programs. They can be creative, but they receive only renderer-provided `ctx` data and declared refs/assets/ranges through literal `inputs` contracts.
- `compiled-plan.json` is renderer-emitted only. Agents do not author exact frame timings or ffmpeg instructions.
- Background music, captions, the presenter bubble (`meta.presenter`: avatar + model badge pulsing with measured narration loudness), repo reads, TTS, timing, muxing, and cache/hashes remain renderer-owned.
- Do **not** hardcode product-specific scene templates in the renderer just because one video needs them. The agent is smart: expose safe primitives, then let the agent compose custom hyperframes when a video needs richer staging.
- Prefer reusable hyperframe components over copy-only templates. Run `bundle components` first; templates are complete examples, not the main reuse layer.
- Use built-in visuals for simple videos. Use bundle hyperframes for great videos that need line-state visual changes, custom layouts, captions working around visuals, music ranges, or multiple repo/data inputs in one narrated chapter.
- Keep hyperframes visually focused. Default to **one focal visual per narration line**; make pace with cuts between map/code/chart/screenshot/callout states, not by placing every declared resource on one crowded frame. Omit `beats` unless a semantic grouping is useful; the renderer creates one implicit beat per narration line.
- **Titles are chapter openers, not scene furniture.** Narration carries the words; most scenes should give the focal visual the whole frame. Use a banner/lower-third on the opener or a real chapter turn — a spec whose every scene starts with an eyebrow + title is a slide deck, not a video.
- **This is video, not a slideshow.** Hyperframe scenes render EVERY frame at the spec fps with a deterministic motion clock: `ctx.scene.progress`, `ctx.time`, and `ctx.range(...)` advance continuously, so range-driven props animate smoothly (a `TravelPath` plane flying Prague→SF, reveals sweeping code, meters filling). The renderer also owns tasteful automatic motion — staggered entrances, chart growth, stat count-ups, checklist pops, word-pop captions, background glow drift — and every animation renders at its END state in stills (workshop, thumbs). Design scenes as moments in time, not static posters: map narration-synced motion to ranges (`inputs: { flight: "line:l1" }` → `ctx.range("flight").progress`). `bundle render --stills` falls back to one held frame per line.
- Hyperframes are trusted local code with static policy lint, not a hostile-code sandbox.

Current bundle commands:

- `bun packages/cli/src/index.ts bundle schema`
- `bun packages/cli/src/index.ts bundle validate <bundle-dir>`
- `bun packages/cli/src/index.ts bundle inspect <bundle-dir>`
- `bun packages/cli/src/index.ts bundle components`
- `bun packages/cli/src/index.ts bundle templates`
- `bun packages/cli/src/index.ts bundle themes`
- `bun packages/cli/src/index.ts bundle workshop <bundle-dir> --out .agent-video/workshop --aspect 16:9,9:16`
- `bun packages/cli/src/index.ts bundle compile <bundle-dir>`
- `bun packages/cli/src/index.ts bundle render <bundle-dir> --out <dir> --aspect 16:9,9:16`

## Agent-first (primary success metric)

Every CLI command must be: non-interactive, all-flags, **structured JSON output**, actionable errors with a `hint` field, idempotent, and self-describing via `--help` with examples. A fresh agent given only the SKILL + `--help` must drive the whole pipeline unaided.

For bundle v2, the key agent-first gate is: an agent should be able to validate
the bundle, compile a plan, inspect scene/line/beat/range timings, and render
without guessing hidden rules. Validation errors must point to the exact
`spec.json` path or hyperframe module and explain the repair.

## Layout (bun workspaces)

- `packages/core` — spec types + published JSON Schema + git/diff parsing + timeline assembler
- `packages/compose` — Mode B: spec → frames (hyperframes), responsive 16:9 + 9:16
- `packages/capture` — Mode A: ported `screen-studio` (avfoundation, macOS-only)
- `packages/hyperframes` — typed hyperframe authoring kit + reusable starter templates
- `packages/providers` — BYO-API model gateway (TTS: Replicate/OpenAI/ElevenLabs + local `say`)
- `packages/render` — orchestrator: validate → resolve refs → TTS → measure → compose+capture → ffmpeg mux + watermark → mp4
- `packages/cli` — `agent-video` binary
- `skills/agent-video`, `skills/agent-video-eval`

## Conventions

- Runtime: **bun** (runs TS directly; no build step needed in dev). Lint: **oxlint**. Tests: `bun test`.
- Prereq: `ffmpeg` (`brew install ffmpeg`).
- Run the CLI locally: `bun packages/cli/src/index.ts <command>`.

## Multi-agent workflow (maintainers)

How maintenance work on this repo is orchestrated across models:

- **Fable (Claude) plans, coordinates, and judges.** It scopes the work, writes the briefs, and reviews every diff before it lands.
- **Scoped subtasks go to WORKER subagents (Codex `gpt-5.5`, high reasoning).** Each worker gets a clear goal, the relevant context, explicit file ownership, and verification commands. Workers do not invent the plan.
- Run independent pieces in parallel — with **disjoint file ownership** per worker.
- Review worker results before merging. If something's off, rewrite the brief and spin another worker; don't silently patch over it (unless the fix is trivial).
