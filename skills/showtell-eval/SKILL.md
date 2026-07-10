---
name: showtell-eval
description: >-
  Evaluate and improve showtell's agent-facing surfaces. Spawns fresh agents
  that — given ONLY the showtell skill + CLI help — author specs for several
  video types, renders them, then an LLM judge scores the output and emits fixes
  to the SKILL / CLI / prompts. Use to verify AGENT-USABILITY + quality, or when
  changing the spec, SKILL, or CLI.
---

# showtell-eval

A self-improvement loop on the agent-facing surface. It answers: _can a fresh
agent, with only the skill and `--help`, make a good video?_ — and feeds back
what to fix.

## Loop

1. **Pick video types** (≥3): e.g. PR walkthrough, codebase tour, demo, release recap.
2. **Author (fresh agents, in parallel).** For each type, spawn an agent whose
   ONLY tool knowledge is `skills/showtell/SKILL.md` + `showtell help` /
   `showtell schema`. It gathers real repo context (git diff, file:line),
   authors `spec.json`, runs `validate` (fixing until ok), then `render
--frames-only`. It also reports any **friction** it hit.
3. **Judge (LLM, per video).** Read the rendered frames + the per-scene
   narration. Score **clarity, visual polish, pacing** 1–5; give an **overall**
   (target **≥4**) and concrete issues.
4. **Aggregate.**
   - **AGENT-USABILITY** passes if ≥3 types validate + render unaided.
   - **JUDGE** passes if overall scores meet the ≥4 target.
5. **Feed back.** Turn the friction + judge issues into concrete edits to
   `skills/showtell/SKILL.md`, the CLI (`--help`, error hints), or the spec
   schema. Re-run until green.

## Deterministic self-test (no agents)

`showtell eval [--spec PATH]` renders the golden example in both ratios and
asserts the CLI gates (both ratios, valid mp4, all kinds rendered, refs read
live, durations synced). Run this on every change; run the full agent loop above
before shipping SKILL/CLI changes.

## Notes

- Author agents avoid `screencap` (needs Screen Recording permission); the
  deterministic self-test provisions a synthetic capture session instead.
- Keep the judge honest: it sees real rendered frames, not the spec's intent.
