/** Hyperframe Workshop: render real component stories with the canvas renderer. */
import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { dimsFor, renderHyperframeElementToPng } from "@agent-video/compose";
import {
  effectiveBeats,
  resolveBundleTheme,
  safeExistingFileInRoot,
  SafeFileError,
  type AspectRatio,
  type BundleError,
  type BundleScene,
} from "@agent-video/core";
import {
  Badge,
  Callout,
  CaptionDeck,
  CaptionSafeArea,
  Chart,
  CodeRef,
  DecisionGrid,
  DiffRef,
  Divider,
  Grid,
  ImageAsset,
  LaneStack,
  Meter,
  Panel,
  PhaseBanner,
  ProofLadder,
  SignalWall,
  Stack,
  Stage,
  StatusRail,
  Text,
  h,
  type CaptionCue,
  type HyperframeElement,
  type ResolvedAsset,
  type ResolvedCode,
  type ResolvedDiff,
} from "@agent-video/hyperframes";
import { compileBundle, renderBundleScene, type BundleVisualMoment } from "./bundle.ts";

export interface WorkshopRenderedFrame {
  id: string;
  title: string;
  group: string;
  description: string;
  aspectRatio: AspectRatio;
  file: string;
  width: number;
  height: number;
  sceneId?: string;
  lineId?: string;
  lineIndex?: number;
  sourceSha256?: string;
  propsSha256?: string;
  resolvedRefs?: { file: string; sha256: string; bytes: number }[];
}

export interface WorkshopRenderResult {
  ok: true;
  stage: "workshop-render" | "bundle-workshop";
  outDir: string;
  indexPath: string;
  manifestPath: string;
  frames: WorkshopRenderedFrame[];
  themeTokens: WorkshopThemeTokenSet[];
  warnings?: unknown[];
}

export interface WorkshopHandle {
  port: number;
  url: string;
  outDir: string;
  stop(): void;
}

interface WorkshopStory {
  id: string;
  title: string;
  group: string;
  description: string;
  build(assetPath: string): { element: HyperframeElement; activeCue?: CaptionCue };
}

interface WorkshopThemeTokenSet {
  id: string;
  title: string;
  description: string;
  colors: {
    bg: string;
    fg: string;
    subtle: string;
    accent: string;
    success: string;
    warning: string;
    surface: string;
    border: string;
    captionBg: string;
    captionFg: string;
  };
  typography: {
    display: string;
    body: string;
    mono: string;
  };
}

const DEFAULT_ASPECTS: AspectRatio[] = ["16:9", "9:16"];

function workshopTheme(
  preset: "agent-dark" | "paper" | "neutral",
  title: string,
  description: string,
): WorkshopThemeTokenSet {
  const theme = resolveBundleTheme({ preset, colors: {}, typography: {} });
  return { id: preset, title, description, colors: theme.colors, typography: theme.typography };
}

const WORKSHOP_THEMES: WorkshopThemeTokenSet[] = [
  workshopTheme("agent-dark", "Agent Dark", "Current deterministic default for technical videos."),
  workshopTheme("paper", "Paper", "Light review surface for checking spacing and hierarchy."),
  workshopTheme("neutral", "Neutral", "Quiet dark-gray system for product walkthroughs."),
];

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fakeCode(): ResolvedCode {
  const text = [
    "export const DecisionGrid = ({ options, activeIndex }) => (",
    '  <Grid columns={3} gap="md">',
    "    {options.map((option, index) => (",
    '      <Panel tone={index === activeIndex ? "accent" : "default"}>',
    '        <Text variant="section">{option.label}</Text>',
    "      </Panel>",
    "    ))}",
    "  </Grid>",
    ");",
  ].join("\n");
  return {
    kind: "code",
    id: "source",
    file: "packages/hyperframes/src/index.ts",
    lineStart: 384,
    lineEnd: 392,
    focus: [387, 388],
    language: "tsx",
    text,
    sha256: sha256(text),
  };
}

function fakeDiff(): ResolvedDiff {
  const text = [
    "@@ component kit @@",
    "- templates: primary reuse path",
    "+ components: primary reuse path",
    "+ workshop: visual review loop",
  ].join("\n");
  return {
    kind: "diff",
    id: "patch",
    file: "docs/bundle-v2.md",
    ref: "main..HEAD",
    text,
    added: 2,
    removed: 1,
    sha256: sha256(text),
    language: "diff",
    rawText: text,
    lines: [
      { kind: "hunk", content: "component kit" },
      { kind: "del", content: "templates: primary reuse path", oldNo: 18 },
      { kind: "add", content: "components: primary reuse path", newNo: 18 },
      { kind: "add", content: "workshop: visual review loop", newNo: 19 },
    ],
  } as ResolvedDiff;
}

function fakeImage(assetPath: string): Extract<ResolvedAsset, { type: "image" }> {
  return {
    type: "image",
    id: "shot",
    src: "workshop-shot.png",
    sha256: "workshop",
    width: 1,
    height: 1,
    path: assetPath,
  };
}

function writeWorkshopImageAsset(outDir: string): string {
  const assetPath = join(outDir, "workshop-shot.png");
  writeFileSync(
    assetPath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lB5MNgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  return assetPath;
}

function stories(): WorkshopStory[] {
  return [
    {
      id: "host-atoms",
      title: "Host Atoms",
      group: "host",
      description: "Panel, Badge, Divider, Meter, Callout, and Text in one stress frame.",
      build: () => ({
        element: h(
          Stage,
          { tone: "paper", padding: "xl" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "lg", grow: true },
              h(PhaseBanner, {
                eyebrow: "host primitives",
                title: "Small pieces, real pixels",
                subtitle: "A component review bench for spacing, type, and state.",
                phase: 0,
              }),
              h(
                Panel,
                { title: "Inspection group", subtitle: "These atoms should feel quiet and precise.", tone: "accent" },
                h(Badge, { text: "active", tone: "info" }),
                h(Text, { variant: "section" }, "Renderer-owned layout keeps authoring simple."),
                h(Divider, { label: "state" }),
                h(Meter, { label: "visual confidence", progress: 0.72, tone: "success" }),
                h(Callout, { text: "If this frame feels cramped, the component kit needs work.", tone: "success" }),
              ),
            ),
          ),
        ),
      }),
    },
    {
      id: "decision-grid",
      title: "Decision Grid",
      group: "story",
      description: "Comparison state with one selected option.",
      build: () => ({
        element: h(
          Stage,
          { tone: "dark", padding: "lg" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "lg", grow: true },
              h(PhaseBanner, { eyebrow: "story component", title: "Choose the reuse layer", phase: 1 }),
              h(DecisionGrid, {
                options: [
                  { label: "Copy starter", detail: "Useful when the whole story shape matches." },
                  { label: "Compose components", detail: "Best default for flexible agent-authored videos." },
                  { label: "Hardcode scenes", detail: "Avoid unless it becomes a renderer primitive." },
                ],
                activeIndex: 1,
                columns: 3,
              }),
            ),
          ),
        ),
      }),
    },
    {
      id: "signal-wall",
      title: "Signal Wall",
      group: "story",
      description: "Dense repeated states for finding overflow and hierarchy issues.",
      build: () => ({
        element: h(
          Stage,
          { tone: "dark", padding: "lg" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "lg", grow: true },
              h(PhaseBanner, { eyebrow: "stress case", title: "Signals stay readable", phase: 2 }),
              h(SignalWall, {
                items: [
                  { label: "Host atoms", detail: "Panel, Badge, Meter, Stack, Text." },
                  { label: "Story blocks", detail: "DecisionGrid, SignalWall, LaneStack." },
                  { label: "Line state", detail: "ctx.scene.lineIndex chooses focus." },
                  { label: "Renderer contract", detail: "No ffmpeg or frame math." },
                ],
                activeIndex: 2,
                columns: 2,
              }),
            ),
          ),
        ),
      }),
    },
    {
      id: "lane-proof",
      title: "Lanes And Proof",
      group: "story",
      description: "Two vertical story components sharing the frame.",
      build: () => ({
        element: h(
          Stage,
          { tone: "paper", padding: "lg" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "lg", grow: true },
              h(PhaseBanner, { eyebrow: "sequence", title: "Agent directs, renderer executes", phase: 3 }),
              h(
                Stack,
                { direction: "horizontal", gap: "lg", grow: true },
                h(LaneStack, {
                  lanes: [
                    { label: "Spec", detail: "Narration, refs, assets, music." },
                    { label: "Hyperframe", detail: "Component tree and line states." },
                    { label: "Renderer", detail: "Timing, captions, muxed output." },
                  ],
                  activeIndex: 2,
                }),
                h(ProofLadder, {
                  items: [
                    { label: "Discover", detail: "bundle components" },
                    { label: "Compose", detail: "one hyperframe" },
                    { label: "Validate", detail: "schema and ports" },
                    { label: "Render", detail: "deterministic mp4" },
                  ],
                  activeIndex: 3,
                }),
              ),
            ),
          ),
        ),
      }),
    },
    {
      id: "status-caption",
      title: "Status And Captions",
      group: "caption",
      description: "Caption-safe composition and active narration cue.",
      build: () => ({
        activeCue: {
          sceneId: "workshop",
          lineId: "caption",
          text: "Captions should support the frame, not fight it.",
          startMs: 0,
          endMs: 3200,
        },
        element: h(
          Stage,
          { tone: "dark", padding: "xl" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "xl", grow: true },
              h(CaptionDeck, {
                eyebrow: "caption layer",
                title: "Leave room for speech",
                subtitle: "Visual captions and canonical subtitles are separate systems.",
                captionMode: "minimal",
              }),
              h(StatusRail, {
                steps: ["discover", "compose", "review", "render"],
                activeIndex: 2,
                progress: 0.75,
              }),
            ),
          ),
        ),
      }),
    },
    {
      id: "media-proof",
      title: "Media Proof",
      group: "media",
      description: "Code, chart, diff, and image primitives with fake renderer-owned inputs.",
      build: (assetPath) => ({
        element: h(
          Stage,
          { tone: "dark", padding: "lg" },
          h(
            CaptionSafeArea,
            {},
            h(
              Stack,
              { direction: "vertical", gap: "lg", grow: true },
              h(PhaseBanner, { eyebrow: "media primitives", title: "Live material slots", phase: 4 }),
              h(
                Grid,
                { columns: 2, gap: "md" },
                h(CodeRef, { source: fakeCode(), focus: [387, 388] }),
                h(Chart, {
                  data: [
                    { label: "spec", value: 4 },
                    { label: "hyperframe", value: 7 },
                    { label: "render", value: 5 },
                  ],
                  type: "bar",
                  x: "label",
                  y: "value",
                  title: "Workflow leverage",
                }),
                h(DiffRef, { source: fakeDiff(), focus: "changed" }),
                h(ImageAsset, { asset: fakeImage(assetPath), fit: "cover" }),
              ),
            ),
          ),
        ),
      }),
    },
  ];
}

function fileBase(story: WorkshopStory, aspectRatio: AspectRatio): string {
  return `${story.group}-${story.id}-${aspectRatio.replace(":", "x")}.png`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function writeIndex(outDir: string, frames: WorkshopRenderedFrame[]): string {
  const groups = [...new Set(frames.map((frame) => frame.group))];
  const selected = frames[0];
  const selectedHtml = selected
    ? `<section class="selected">
      <div class="selected-copy">
        <p>Selected frame</p>
        <h2>${escapeHtml(selected.title)}</h2>
        <span>${escapeHtml(selected.description)}</span>
      </div>
      <img src="${escapeHtml(selected.file)}" width="${selected.width}" height="${selected.height}" alt="${escapeHtml(selected.title)} selected preview" />
    </section>`
    : "";
  const body = groups
    .map((group) => {
      const items = frames.filter((frame) => frame.group === group);
      return `<section class="group">
  <header><p>${escapeHtml(group)}</p><h2>${escapeHtml(group)} components</h2></header>
  <div class="grid">
    ${items
      .map((frame) => {
        return `<article class="card">
          <div class="meta">
            <div><h3>${escapeHtml(frame.title)}</h3><p>${escapeHtml(frame.description)}</p></div>
            <span>${escapeHtml(frame.aspectRatio)}</span>
          </div>
          <img src="${escapeHtml(frame.file)}" width="${frame.width}" height="${frame.height}" alt="${escapeHtml(frame.title)} ${escapeHtml(frame.aspectRatio)}" />
        </article>`;
      })
      .join("\n")}
  </div>
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Hyperframe Workshop</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f6f8;
      --fg: #171923;
      --muted: #616978;
      --line: #d9dee7;
      --panel: #ffffff;
      --accent: #5b67f1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--fg);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(1680px, calc(100vw - 48px)); margin: 0 auto; padding: 32px 0 56px; }
    .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
    h1 { margin: 0; font-size: clamp(32px, 4vw, 72px); line-height: 0.96; letter-spacing: 0; }
    .top p { margin: 10px 0 0; max-width: 720px; color: var(--muted); font-size: 18px; line-height: 1.5; }
    .summary { text-align: right; color: var(--muted); font-size: 14px; }
    .summary strong { display: block; color: var(--fg); font-size: 28px; }
    .selected {
      margin-top: 24px;
      display: grid;
      grid-template-columns: minmax(0, 0.34fr) minmax(0, 0.66fr);
      gap: 18px;
      align-items: stretch;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .selected-copy { padding: 24px; display: flex; flex-direction: column; justify-content: flex-end; min-height: 260px; }
    .selected-copy p { margin: 0 0 10px; color: var(--accent); font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; }
    .selected-copy h2 { margin: 0; font-size: clamp(26px, 3vw, 48px); line-height: 1; }
    .selected-copy span { display: block; margin-top: 14px; color: var(--muted); font-size: 18px; line-height: 1.45; }
    .selected > img { height: 100%; object-fit: cover; }
    .group { margin-top: 36px; }
    .group > header { display: flex; align-items: baseline; gap: 14px; margin-bottom: 14px; }
    .group > header p { margin: 0; color: var(--accent); font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: 0.08em; }
    .group > header h2 { margin: 0; font-size: 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(430px, 1fr)); gap: 18px; }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .meta { min-height: 96px; display: flex; justify-content: space-between; gap: 18px; padding: 18px; border-bottom: 1px solid var(--line); }
    .meta h3 { margin: 0 0 7px; font-size: 18px; }
    .meta p { margin: 0; color: var(--muted); line-height: 1.45; }
    .meta span { height: fit-content; border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; color: var(--muted); font-weight: 700; font-size: 12px; }
    img { display: block; width: 100%; height: auto; background: #101322; }
    @media (max-width: 720px) {
      main { width: min(100vw - 24px, 680px); padding-top: 22px; }
      .top { display: block; }
      .summary { text-align: left; margin-top: 18px; }
      .selected { grid-template-columns: 1fr; }
      .selected-copy { min-height: unset; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="top">
      <div>
        <h1>Hyperframe Workshop</h1>
        <p>Real renderer output for reviewing component spacing, hierarchy, caption safety, and media primitives before rendering a full video.</p>
      </div>
      <div class="summary"><strong>${frames.length}</strong> rendered frames</div>
    </section>
    ${selectedHtml}
    ${body}
  </main>
</body>
</html>`;
  const indexPath = join(outDir, "index.html");
  writeFileSync(indexPath, html);
  return indexPath;
}

export async function renderWorkshop(
  opts: {
    outDir?: string;
    aspectRatios?: AspectRatio[];
  } = {},
): Promise<WorkshopRenderResult> {
  const outDir = resolve(opts.outDir ?? ".agent-video/workshop");
  const ratios = opts.aspectRatios ?? DEFAULT_ASPECTS;
  mkdirSync(outDir, { recursive: true });
  const assetPath = writeWorkshopImageAsset(outDir);
  const renderedFrames: WorkshopRenderedFrame[] = [];
  const allStories = stories();

  for (const story of allStories) {
    for (const aspectRatio of ratios) {
      const { element, activeCue } = story.build(assetPath);
      const rendered = await renderHyperframeElementToPng(element, {
        aspectRatio,
        activeCue,
        theme: resolveBundleTheme(),
        watermark: false,
      });
      const file = fileBase(story, aspectRatio);
      const path = join(outDir, file);
      writeFileSync(path, rendered.png);
      const dims = dimsFor(aspectRatio);
      renderedFrames.push({
        id: story.id,
        title: story.title,
        group: story.group,
        description: story.description,
        aspectRatio,
        file,
        width: dims.width,
        height: dims.height,
      });
    }
  }

  const indexPath = writeIndex(outDir, renderedFrames);
  const manifestPath = join(outDir, "workshop-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        title: "Hyperframe Workshop",
        frames: renderedFrames,
        themeTokens: WORKSHOP_THEMES,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    ok: true,
    stage: "workshop-render",
    outDir,
    indexPath,
    manifestPath,
    frames: renderedFrames,
    themeTokens: WORKSHOP_THEMES,
  };
}

function beatIdForLine(scene: BundleScene, lineId: string): string | undefined {
  return effectiveBeats(scene).find((beat) => beat.lines.includes(lineId))?.id;
}

export async function renderBundleWorkshop(
  bundleDirInput: string,
  opts: { outDir?: string; aspectRatios?: AspectRatio[] } = {},
): Promise<WorkshopRenderResult> {
  const compiled = await compileBundle(bundleDirInput);
  const outDir = resolve(opts.outDir ?? join(compiled.bundleDir, "workshop"));
  const ratios = opts.aspectRatios ?? compiled.spec.meta.aspectRatios;
  mkdirSync(outDir, { recursive: true });
  const frames: WorkshopRenderedFrame[] = [];
  const warnings: BundleError[] = [...compiled.warnings];
  const warningKeys = new Set(warnings.map((warning) => `${warning.path}:${warning.message}`));

  for (const aspectRatio of ratios) {
    for (const scene of compiled.spec.scenes) {
      const planScene = compiled.plan.scenes.find((item) => item.id === scene.id)!;
      for (let lineIndex = 0; lineIndex < planScene.narration.lines.length; lineIndex++) {
        const line = planScene.narration.lines[lineIndex]!;
        const moment: BundleVisualMoment = {
          sceneIndex: planScene.index,
          lineIndex,
          lineCount: planScene.narration.lines.length,
          lineId: line.id,
          beatId: beatIdForLine(scene, line.id),
          progress: planScene.narration.lines.length === 1 ? 1 : lineIndex / (planScene.narration.lines.length - 1),
        };
        const rendered = await renderBundleScene(scene, planScene, compiled, aspectRatio, moment);
        if (rendered.warning) {
          const warning: BundleError = {
            code: "RENDER_WARNING",
            path: `scenes.${planScene.index}.narration.lines.${lineIndex}`,
            message: rendered.warning,
            hint: "Inspect the visual inputs for this line; the renderer produced a fallback or warning state.",
          };
          const key = `${warning.path}:${warning.message}`;
          if (!warningKeys.has(key)) {
            warnings.push(warning);
            warningKeys.add(key);
          }
        }
        const file = `scene-${String(planScene.index).padStart(3, "0")}-${scene.id}-${line.id}-${aspectRatio.replace(":", "x")}.png`;
        writeFileSync(join(outDir, file), rendered.png);
        frames.push({
          id: `${scene.id}/${line.id}`,
          title: `${scene.id} / ${line.id}`,
          group: scene.id,
          description: line.text,
          aspectRatio,
          file,
          width: rendered.width,
          height: rendered.height,
          sceneId: scene.id,
          lineId: line.id,
          lineIndex,
          sourceSha256: planScene.hyperframe?.sourceSha256,
          propsSha256: planScene.hyperframe?.propsSha256,
          resolvedRefs: rendered.resolvedRefs.map((ref) => ({
            file: ref.file,
            bytes: Buffer.byteLength(ref.text),
            sha256: sha256(ref.text),
          })),
        });
      }
    }
  }

  const indexPath = writeIndex(outDir, frames);
  const manifestPath = join(outDir, "workshop-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        title: `${compiled.spec.meta.title} Workshop`,
        bundleDir: ".",
        planPath: "compiled-plan.json",
        frames,
        themeTokens: WORKSHOP_THEMES,
        warnings,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    ok: true,
    stage: "bundle-workshop",
    outDir,
    indexPath,
    manifestPath,
    frames,
    themeTokens: WORKSHOP_THEMES,
    warnings,
  };
}

const CTYPE: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

function safeFile(root: string, rel: string): string | null {
  if (rel.split(/[\\/]/).some((part) => part.startsWith("."))) return null;
  try {
    return safeExistingFileInRoot(root, rel).path;
  } catch (e) {
    if (e instanceof SafeFileError) return null;
    throw e;
  }
}

export function startWorkshopServer(opts: { outDir: string; port?: number }): WorkshopHandle {
  const outDir = resolve(opts.outDir);
  const server = Bun.serve({
    port: opts.port ?? 0,
    fetch(req) {
      let path = decodeURIComponent(new URL(req.url).pathname);
      if (path === "/status") return Response.json({ ok: true, stage: "workshop-serve", outDir });
      if (path === "/") path = "/index.html";
      const file = safeFile(outDir, path.slice(1));
      if (!file) return new Response("not found", { status: 404 });
      return new Response(Bun.file(file), {
        headers: { "content-type": CTYPE[extname(file).toLowerCase()] ?? "application/octet-stream" },
      });
    },
  });
  const port = server.port;
  if (port == null) throw new Error("Workshop server failed to bind to a port.");
  return { port, url: `http://localhost:${port}/`, outDir, stop: () => server.stop(true) };
}
