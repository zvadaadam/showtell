# Developing Showtell

Requirements: Apple Silicon macOS or glibc-based Linux, [Bun](https://bun.sh),
[ffmpeg](https://ffmpeg.org), and Git 2.24 or newer. Linux contributors also
need `espeak-ng` for local narration tests. Screen capture development is
macOS-only.

```bash
bun install
bun run format:check
bun run lint
bun run typecheck
bun test
```

Run the TypeScript CLI directly during development:

```bash
bun packages/cli/src/index.ts help
```

Build the self-contained host binary and stage the root npm launcher plus the
matching native package:

```bash
bun run build:cli
bun run build:npm

./dist/showtell version
TARGET=darwin-arm64 # or linux-x64 / linux-arm64
./dist/npm/showtell-$TARGET/bin/showtell version
```

The generated `dist/npm/showtell` package is a small Node launcher. The matching
`dist/npm/showtell-<platform>` package contains the compiled binary and web
player. Inspect both packages before publishing:

```bash
npm publish ./dist/npm/showtell --dry-run
npm publish "./dist/npm/showtell-$TARGET" --dry-run
```

For a local dry run, `build:release` builds archives for the current host. A
real release is tag-driven: bump the root version, commit it, then push the
matching tag. CI builds all three platforms, publishes native packages first,
publishes the root launcher last, and creates the checksummed GitHub Release.

```bash
bun run build:release
git tag vX.Y.Z
git push origin vX.Y.Z
```

Do not manually publish only `showtell-X.Y.Z.tgz`: it has exact optional
dependencies on all three same-version native packages.

The workspace packages remain internal implementation modules under the
`@showtell/*` namespace. The public distribution is the single unscoped
`showtell` package and its `showtell` executable.
