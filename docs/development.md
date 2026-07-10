# Developing Showtell

Requirements: Apple Silicon macOS or glibc-based Linux, [Bun](https://bun.sh),
[ffmpeg](https://ffmpeg.org), and Git 2.24 or newer. Linux contributors also
need `espeak-ng` for local narration tests. Screen capture development is
macOS-only.

```bash
bun install
bun run lint
bun run typecheck
bun test
```

Run the TypeScript CLI directly during development:

```bash
bun packages/cli/src/index.ts help
```

Build the self-contained binary and the npm staging package:

```bash
bun run build:cli
bun run build:npm

./dist/showtell version
./dist/npm/showtell/bin/showtell version
```

The npm staging directory is generated under `dist/npm/showtell` and contains
only the compiled binary, package manifest, README, and MIT license. Inspect it
before publishing:

```bash
npm publish ./dist/npm/showtell --dry-run
```

Build the complete release set—including the npm tarball—and publish that exact
artifact when the version is ready:

```bash
bun run build:release
npm publish ./dist/release/showtell-0.1.0.tgz --access public
```

The workspace packages remain internal implementation modules under the
`@showtell/*` namespace. The public distribution is the single unscoped
`showtell` package and its `showtell` executable.
