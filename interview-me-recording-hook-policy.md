# Interview: recording hook policy

**Status**: complete
**Started**: 2026-07-01
**Last updated**: 2026-07-01

## Topic

Decide the product policy for agent-video recording hooks: whether command execution hooks belong in CLI only, MCP too, and what safety/agent UX contract should govern them.

## Open Questions

## Resolved Decisions

- MCP should not run arbitrary user/repo-provided shell commands by default — expose named built-in recording actions instead, so the agent API stays safe and predictable.
- Recording orchestration should be CLI-first for now — drop MCP recording control from the current scope and make the wrapper around agent tools excellent.
- MCP is out of v1 entirely — remove the package so the only agent-facing product surface is the CLI.

## Q&A Log

### Q1: Should arbitrary command hooks be exposed through MCP, or only through local CLI/config?

**Recommendation**: Keep arbitrary shell commands out of MCP by default; expose typed recording actions instead.
**Answer**: Agreed: MCP should use strict built-in actions, not arbitrary configured shell commands.
**Notes**: CLI/config can still grow power-user hooks later, but MCP should present a small typed product surface.

### Q2: Which built-in recorder integrations should MCP expose first?

**Recommendation**: Start with a stable recording source shape, but only implement the existing screen capture path end-to-end.
**Answer**: The better product may be a CLI recording wrapper around tools like Argent, agent-browser, or agent-device; MCP may not be needed for that part at all.
**Notes**: This shifts the design from "MCP controls recorders" toward "CLI supervises the child agent/tool process and records around it."

### Q3: Should MCP be dropped from recording orchestration for now?

**Recommendation**: Yes. Make the CLI wrapper the product surface for recording orchestration and revisit MCP later for safe metadata/render operations.
**Answer**: Agreed: drop MCP recording control for now.
**Notes**: This keeps the near-term product smaller and cleaner. MCP may still be useful later for render/session metadata, but not for running or supervising browser/device tools.

### Q4: Should the MCP package remain for safe render/session tools?

**Recommendation**: No. If v1 is CLI-first, remove the MCP package entirely so agents do not discover a second partial product surface.
**Answer**: Agreed: the folder itself is unnecessary right now.
**Notes**: MCP can come back later as a deliberate package once the CLI wrapper workflow is proven.

## Plan

- Remove `packages/mcp` entirely.
- Keep CLI external capture workflows as the current orchestration surface.
- Update tests, docs, examples, lockfile metadata, and agent guidance so future agents discover only the CLI-first boundary.
