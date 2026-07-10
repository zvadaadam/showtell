# @showtell/core

The contract. Defines the `VideoSpec` (zod) that the agent authors, generates the
published JSON Schema from it (single source of truth — no drift), validates specs,
and resolves repo references to **live bytes**.

- `VideoSpec`, scene types — the zod spec (all 6 scene kinds), TS types inferred.
- `validateSpec(data)` — structured result: `{ ok, spec }` or `{ ok:false, errors:[{path,message,hint}] }`.
- `videoSpecJsonSchema()` — the published JSON Schema (also `core/schema.json`).
- `repo.ts` — `git show`/file reads for `code`/`diff` scenes (the renderer reads source, never pasted code).

Part of [showtell](../../README.md).
