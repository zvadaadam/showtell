# Contributing to Showtell

Thanks for helping make agent-authored video better.

## Before you start

- Use an issue for significant features or contract changes so the direction
  can be agreed before implementation.
- Keep the core contract intact: agents author specs, browser HyperFrames, and
  declared assets; the renderer owns timing, source resolution, and ffmpeg.
- Treat browser HyperFrames as trusted local code and never weaken path
  containment, browser policy, or deterministic rendering guarantees.

## Local setup

Install Bun, Git, and ffmpeg. Linux contributors also need `espeak-ng`.

```bash
bun install
bun run lint
bun run format:check
bun run typecheck
bun test
```

Run the CLI from source with:

```bash
bun packages/cli/src/index.ts help
```

See [docs/development.md](docs/development.md) for packaging and release details
and [docs/bundle-v3.md](docs/bundle-v3.md) for the authoring model.

## Pull requests

- Keep changes focused and include tests for behavior changes.
- Update schemas and user documentation when a public contract changes.
- Run the complete checks above before opening the PR.
- Explain user-visible behavior, tradeoffs, and platform-specific testing in
  the PR description.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
