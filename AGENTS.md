# showtell — agent guide

**What this is:** "A motion engine for agents" — a local, repo-aware **motion render engine**. A coding agent authors intent (`spec.json` + hyperframes) and the engine renders every frame on a deterministic motion clock into a short narrated MP4 — animated visualization, not slide generation. Being local is the moat: code/diff visuals reference the repo by `file:line`/git ref and the renderer reads the **live bytes**, so rendered code is always ground-truth.

**The guiding principle: everything is motion.** Showtell seeks the authored browser world at every exact encoded timestamp (`packages/render/src/web-frame.ts` is the executor; `window.__showtell.time` and `window.__showtell.range()` are the authoring surface). When adding or reviewing features, ask how they move, not just how they look — stills are held samples, never the design target.

**Read first:** `docs/bundle-v3.md` for the browser authoring model, plus `.context/plan/showtell-goal.md` when present. Progress + gate ledger: `.context/plan/showtell-progress.md`.

## The contract (never violate)

- For simple videos, the LLM authors a JSON-Schema-validated `spec.json` (`meta` + ordered `scenes[]`, each with `narration`).
- For bundle videos, the LLM may author `spec.json`, `hyperframes/*.html`, and declared assets. It still NEVER writes ffmpeg, frame math, pasted repo source, or `compiled-plan.json`.
- `code`/`diff` material carries repo **references** (`file`, `lineStart/End`, git `ref`), never pasted code.
- Narration uses `duration: "auto"` → the renderer is **two-pass** (synthesize TTS → measure with ffprobe → lay out visuals so audio/visuals stay synced).
- Deterministic: identical resolved inputs on the same supported platform and pinned runtime produce the same MP4 bytes. No `Date.now()` / unseeded `Math.random()` in render components. Content-hash cache; TTS cached per narration line.

## Bundle v3 direction

Bundle v3 is a **bundle**, not a giant JSON timeline:

```text
my-video.showtell/
  spec.json
  hyperframes/*.html
  assets/**
  compiled-plan.json  # renderer-generated after compile
```

- `spec.json` stays the orchestration contract: metadata, narration, repo refs, assets, captions, music, scenes, optional beats/ranges, hyperframe entry points, and `visual.inputs` mappings.
- Shared video style belongs in `meta.theme`: choose a semantic `preset` by mood (`ink` is the default; run `bundle themes` for all seven), then override only needed `colors`/`typography`/`chart` tokens. Do not hardcode brand colors or fonts independently in every hyperframe unless the frame intentionally breaks the system; do not use Tailwind-style class strings.
- `hyperframes/*.html` are agent-authored deterministic visual programs: normal HTML/CSS plus one paused GSAP timeline. They receive only renderer-provided `window.__showtell` state and declared refs/assets/ranges through literal manifest ports.
- `compiled-plan.json` is renderer-emitted only. Agents do not author exact frame timings or ffmpeg instructions.
- Background music, captions, the presenter bubble (`meta.presenter`: avatar + model badge pulsing with measured narration loudness), repo reads, TTS, timing, muxing, and cache/hashes remain renderer-owned.
- Do **not** hardcode product-specific scene templates in the renderer just because one video needs them. The agent is smart: expose safe primitives, then let the agent compose custom hyperframes when a video needs richer staging.
- Run `bundle components` and `bundle templates` before authoring so the agent uses the current browser contract instead of guessing it.
- Browser HyperFrames are the only designed visual runtime. Declarative simple specs compile to trusted internal web programs; bundle scenes use `visual.kind: "web"`. Use `visual.kind: "screencap"` only for recorded capture media, not as a competing design renderer.
- Keep browser HyperFrames visually focused. Default to **one focal visual per narration line**; make pace with cuts between map/code/chart/screenshot/callout states, not by placing every declared resource on one crowded frame. Omit `beats` unless a semantic grouping is useful; the renderer creates one implicit beat per narration line.
- **Titles are chapter openers, not scene furniture.** Narration carries the words; most scenes should give the focal visual the whole frame. Use a banner/lower-third on the opener or a real chapter turn — a spec whose every scene starts with an eyebrow + title is a slide deck, not a video.
- **This is video, not a slideshow.** Browser HyperFrames render EVERY frame at the spec fps. Showtell seeks the one paused GSAP timeline using the measured scene clock; `window.__showtell.time` and `window.__showtell.range(...)` advance deterministically. Design scenes as moments in time, not static posters: map narration-synced motion to declared ranges (`inputs: { flight: "line:l1" }` → `st.range("flight")`). Workshop captures one representative held frame per line; use `bundle review` as the motion proof.
- Browser HyperFrames are trusted local code with static policy lint, CSP, blocked network requests, and deterministic runtime guards, not a hostile-code sandbox.

Current bundle commands:

- `bun packages/cli/src/index.ts bundle schema`
- `bun packages/cli/src/index.ts bundle validate <bundle-dir>`
- `bun packages/cli/src/index.ts bundle inspect <bundle-dir>`
- `bun packages/cli/src/index.ts bundle components`
- `bun packages/cli/src/index.ts bundle templates`
- `bun packages/cli/src/index.ts bundle themes`
- `bun packages/cli/src/index.ts bundle runtime`
- `bun packages/cli/src/index.ts bundle workshop <bundle-dir> --out .showtell/workshop --aspect 16:9,9:16`
- `bun packages/cli/src/index.ts bundle compile <bundle-dir>`
- `bun packages/cli/src/index.ts bundle review <bundle-dir> --out .showtell/review --aspect 16:9,9:16 --samples 5`
- `bun packages/cli/src/index.ts bundle render <bundle-dir> --out <dir> --aspect 16:9,9:16`

Use `bundle workshop` for a fast held-state layout gallery: it renders representative PNGs
per scene/line/aspect for hierarchy, captions, and responsive fit. Use
`bundle review` for motion judgment: it samples exact video
timestamps per narration line, writes `review-manifest.json`, and produces
filmstrips where browser pixel movement and aspect adaptation can be inspected.
Workshop, review, and render compile the bundle themselves. Run `bundle compile`
directly only when you need to inspect `compiled-plan.json`. Review warnings are
advisory quality signals; they do not fail a valid render.

## Agent-first (primary success metric)

Every CLI command must be: non-interactive, all-flags, **structured JSON output**, actionable errors with a `hint` field, idempotent, and self-describing via `--help` with examples. A fresh agent given only the SKILL + `--help` must drive the whole pipeline unaided.

For bundle v3, the key agent-first gate is: an agent should be able to validate
and inspect the bundle, compile a plan, review exact-timestamp filmstrips, and
render without guessing hidden rules. Validation errors must point to the exact
`spec.json` path or browser HyperFrame and explain the repair; review warnings
must remain actionable but advisory.

## Layout (bun workspaces)

- `packages/core` — spec types + published JSON Schema + git/diff parsing + timeline assembler
- `packages/compose` — renderer-owned captions, presenter, watermark chrome, and reusable browser visual support
- `packages/capture` — Mode A: ported `screen-studio` (avfoundation, macOS-only)
- `packages/providers` — BYO-API model gateway (TTS: Replicate/OpenAI/ElevenLabs + local `say`)
- `packages/render` — orchestrator and browser runtime: validate → resolve refs → TTS → measure → exact-frame capture → ffmpeg mux → mp4
- `packages/cli` — `showtell` binary
- `skills/showtell`, `skills/showtell-eval`

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
