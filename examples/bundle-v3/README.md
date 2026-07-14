# Bundle v3 example

This example uses Showtell's primary browser visual runtime: bundle-local HTML/CSS, a paused GSAP timeline, a semantic narration range, and live code bytes rendered by `<st-code>`.

```bash
bun packages/cli/src/index.ts bundle validate examples/bundle-v3
bun packages/cli/src/index.ts bundle inspect examples/bundle-v3
bun packages/cli/src/index.ts bundle compile examples/bundle-v3
bun packages/cli/src/index.ts bundle review examples/bundle-v3 --out .showtell/bundle-v3-review --aspect 16:9,9:16
bun packages/cli/src/index.ts bundle render examples/bundle-v3 --out .showtell/bundle-v3 --aspect 16:9,9:16
```

Change the referenced browser-runtime contract in `packages/render/src/web-authoring.ts`, recompile, and the code pixels change without editing the HTML.
