import { createHash } from "node:crypto";
import motionWorldSource from "./motion-world.html" with { type: "text" };
import { webComponentsSource } from "./web-components.ts";

/** Exact browser/toolchain identity recorded in every compiled v3 web scene. */
export const webRuntimeIdentity = Object.freeze({
  engine: "chromium",
  distribution: "headless-shell",
  // Chromium build prefix for the pinned revision: platform builds of the same
  // revision report different patch components (e.g. .55 on macOS, .0 on Linux),
  // so the exact binary is pinned by chromiumRevision + playwright version.
  browserVersion: "149.0.7827",
  chromiumRevision: "1228",
  playwright: "1.61.1",
  gsap: "3.14.2",
  componentsSourceSha256: createHash("sha256").update(webComponentsSource).digest("hex"),
  deviceScaleFactor: 1,
  locale: "en-US",
  timezone: "UTC",
  colorProfile: "srgb",
  colorScheme: "dark",
  reducedMotion: "reduce",
  fonts: Object.freeze([
    { family: "Inter", version: "5.2.8", weights: [400, 500, 600, 700] },
    { family: "League Gothic", version: "5.2.8", weights: [400] },
    { family: "JetBrains Mono", version: "5.2.8", weights: [400] },
    { family: "Space Mono", version: "5.2.8", weights: [400] },
  ]),
});

export type WebRuntimeIdentity = typeof webRuntimeIdentity;

/** Machine-readable discovery for the primary bundle v3 visual runtime. */
export const webRuntimeManifest = Object.freeze({
  kind: "web",
  bundleVersion: 3,
  manifestVersion: 3,
  source: "bundle-local HTML",
  animation: "one paused GSAP timeline, sought by Showtell at exact compiled timestamps",
  global: "window.__showtell",
  identity: webRuntimeIdentity,
  injectedLibraries: { gsap: webRuntimeIdentity.gsap },
  deterministic: {
    time: "window.__showtell.time",
    random: "window.__showtell.random(key)",
    ranges: "window.__showtell.range(name)",
    forbidden: [
      "network",
      "timers",
      "CSS animations/transitions",
      "Web Animations API",
      "SVG SMIL animation",
      "Math.random",
      "Web Crypto randomness",
      "wall-clock APIs",
    ],
  },
});

export const webComponentManifest = Object.freeze([
  {
    tag: "st-code",
    purpose: "Render live bytes from a declared code repo input with line numbers and narration-synced reveal.",
    ports: {
      input: { required: true, kind: "repo", refKind: "code" },
      reveal: { required: false, kind: "range" },
    },
    attributes: {
      input: { required: true, value: "repo input port whose refKind is code" },
      "reveal-range": { required: false, value: "range input port" },
      "max-lines": { required: false, value: "positive integer; default 22" },
    },
    example: '<st-code input="source" reveal-range="reveal" max-lines="18"></st-code>',
  },
  {
    tag: "st-diff",
    purpose:
      "Render a live declared diff with old/new line numbers, hunk context, addition/deletion styling, and narration-synced reveal.",
    ports: {
      input: { required: true, kind: "repo", refKind: "diff" },
      reveal: { required: false, kind: "range" },
    },
    attributes: {
      input: { required: true, value: "repo input port whose refKind is diff" },
      "reveal-range": { required: false, value: "range input port" },
      "max-lines": { required: false, value: "positive integer; default 22" },
    },
    example: '<st-diff input="change" reveal-range="reveal" max-lines="18"></st-diff>',
  },
  {
    tag: "st-chart",
    purpose: "Render bar, line, or pie motion from a declared JSON data asset using the resolved theme chart palette.",
    ports: {
      input: { required: true, kind: "asset", assetType: "data" },
      reveal: { required: false, kind: "range" },
    },
    attributes: {
      input: { required: true, value: "asset input port whose assetType is data" },
      type: { required: false, value: '"bar", "line", or "pie"; default "bar"' },
      x: { required: false, value: "row field used for labels; inferred when omitted" },
      y: { required: false, value: "comma-separated numeric row fields; inferred when omitted" },
      title: { required: false, value: "plain chart title" },
      "reveal-range": { required: false, value: "range input port" },
      "max-items": { required: false, value: "positive integer; default 12" },
    },
    dataShape: "JSON row array, or an object with a data or rows array",
    example:
      '<st-chart input="metrics" type="bar" x="label" y="value" title="Weekly adoption" reveal-range="reveal"></st-chart>',
  },
]);

export const webCssVariables = Object.freeze([
  "--st-bg",
  "--st-fg",
  "--st-subtle",
  "--st-accent",
  "--st-accent-2",
  "--st-success",
  "--st-warning",
  "--st-surface",
  "--st-border",
  "--st-caption-bg",
  "--st-caption-fg",
  "--st-font-display",
  "--st-font-body",
  "--st-font-mono",
  "--st-safe-top",
  "--st-safe-right",
  "--st-safe-bottom",
  "--st-safe-left",
  "--st-chart-1",
  "--st-chart-2",
  "--st-chart-3",
  "--st-chart-4",
  "--st-chart-5",
  "--st-chart-6",
  "--st-chart-7",
  "--st-chart-8",
  "--st-chart-9",
  "--st-chart-10",
]);

export const webStarterTemplates = Object.freeze([
  {
    id: "motion-world",
    runtime: "web",
    file: "hyperframes/main.html",
    description: "A persistent visual world, live repo proof, and semantic-range GSAP choreography.",
    source: motionWorldSource,
  },
]);
