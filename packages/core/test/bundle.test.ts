import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBundleTheme, validateBundle } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

test("bundle v3 example validates with live refs and a web visual", () => {
  const result = validateBundle(join(ROOT, "examples", "bundle-v3"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.spec.version).toBe(3);
    expect(result.spec.scenes).toHaveLength(1);
    expect(result.spec.scenes[0]!.visual.kind).toBe("web");
    expect(result.warnings).toHaveLength(0);
  }
});

test("bundle validation reports actionable missing asset errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-invalid-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Bad", repo: { path: ROOT } },
      assets: { missing: { type: "data", src: "assets/missing.json" } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Hello." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );
  mkdirSync(join(dir, "assets"), { recursive: true });

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((error) => error.code === "MISSING_ASSET" && Boolean(error.hint))).toBe(true);
  }
});

test("bundle validation accepts documented cross-scene time refs", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-time-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Time refs", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
        {
          id: "proof",
          narration: { lines: [{ id: "l1", text: "Proof." }] },
          ranges: { full: { from: "scene:intro@start", to: "scene:proof@end" } },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
});

test("bundle validation accepts screencap playback and clip semantics", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-screencap-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Screencap", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: {
            kind: "screencap",
            sessionRef: "recording_01",
            clip: { start: 1.25, end: 4.5 },
            playback: {
              mode: "smart",
              preActionPaddingMs: 120,
              postActionPaddingMs: 240,
              targetGapOutputMs: 500,
              maxGapOutputMs: 800,
              maxPlaybackRate: 8,
              minGapToSpeedUpMs: 250,
              camera: "follow",
              actionEffects: "tap-glow",
              visualSampleFps: 4,
              visualMinScore: 0.7,
            },
          },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.spec.scenes[0]!.visual).toMatchObject({
      kind: "screencap",
      sessionRef: "recording_01",
      clip: { start: 1.25, end: 4.5 },
      playback: { mode: "smart", camera: "follow", actionEffects: "tap-glow" },
    });
    expect(result.warnings).toHaveLength(0);
  }
});

test("bundle validation accepts semantic theme presets and partial overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: {
        title: "Theme",
        repo: { path: ROOT },
        theme: {
          preset: "paper",
          colors: {
            accent: "#2563eb",
          },
          typography: {
            display: "Inter Bold",
          },
        },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.spec.meta.theme?.preset).toBe("paper");
    expect(result.spec.meta.theme?.colors.accent).toBe("#2563eb");
    expect(result.spec.meta.theme?.typography.display).toBe("Inter Bold");
  }
});

test("bundle validation rejects the removed authored theme mode alias", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-mode-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: {
        title: "Theme mode",
        repo: { path: ROOT },
        theme: { mode: "paper" },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "SCHEMA_ERROR", path: "meta.theme" }));
  }
});

test("bundle validation rejects non-hex theme colors and CSS font stacks", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-bad-theme-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: {
        title: "Bad theme",
        repo: { path: ROOT },
        theme: {
          preset: "ink",
          colors: {
            bg: "purple",
          },
          typography: {
            display: "Inter, system-ui",
          },
        },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "SCHEMA_ERROR", path: "meta.theme.colors.bg" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "SCHEMA_ERROR", path: "meta.theme.typography.display" }),
    );
  }
});

test("bundle validation rejects unreadable theme contrast and warns on weak accents", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-contrast-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: {
        title: "Bad contrast",
        repo: { path: ROOT },
        theme: {
          preset: "paper",
          colors: {
            fg: "#ffffff",
            bg: "#ffffff",
            accent: "#f7f4ec",
          },
        },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "LOW_THEME_CONTRAST" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "WEAK_ACCENT_CONTRAST" }));
  }
});

test("bundle validation warns on unregistered theme fonts", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-font-warning-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: {
        title: "Theme font",
        repo: { path: ROOT },
        theme: { preset: "ink", typography: { body: "Aptos" } },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.warnings).toContainEqual(expect.objectContaining({ code: "UNKNOWN_THEME_FONT" }));
});

test("resolveBundleTheme returns complete deterministic runtime tokens", () => {
  const theme = resolveBundleTheme({ preset: "paper", colors: { accent: "#2563eb" }, typography: {} });
  expect(theme).toMatchObject({
    preset: "paper",
    mode: "paper",
    colors: {
      bg: "#f7f4ec",
      fg: "#191b29",
      accent: "#2563eb",
      surface: "#ffffff",
      border: "#d0d7de",
      captionBg: "#111827",
      captionFg: "#f8fafc",
    },
    typography: {
      display: "Inter Bold",
      body: "Inter",
      mono: "JetBrains Mono",
    },
  });
});

test("published bundle schema exposes preset and partial color overrides", () => {
  const schemaPath = join(ROOT, "packages", "core", "bundle.schema.json");
  expect(existsSync(schemaPath)).toBe(true);
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as { definitions?: Record<string, unknown> };
  const text = JSON.stringify(schema);
  expect(text).toContain('"preset"');
  expect(text).toContain('"ink"');
  expect(text).not.toContain('"agent-dark"');
  expect(text).toContain('"accent"');
  expect(text).toContain("#[0-9a-fA-F]{6}");
});

test("bundle validation catches bad music ranges before compile", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-music-range-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "bed.wav"), "not real audio but enough for validation");
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Bad music range", repo: { path: ROOT } },
      assets: { bed: { type: "audio", src: "assets/bed.wav" } },
      audio: { music: [{ id: "bed", asset: "bed", range: "scene:nope" }] },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_TIME_REF", path: "audio.music.0.range" }),
    );
  }
});

test("bundle validation rejects git-option diff refs before compile", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-git-option-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Git option", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: { diff: { kind: "diff", file: "README.md", ref: "--output=/tmp/showtell-pwned" } },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BAD_REPO_REF", path: "scenes.0.refs.diff" }));
  }
});

test("bundle validation rejects working-tree code symlinks", () => {
  const repo = mkdtempSync(join(tmpdir(), "av-bundle-code-symlink-repo-"));
  symlinkSync("/etc/hosts", join(repo, "leak.ts"));
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-code-symlink-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Code symlink", repo: { path: repo } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: { source: { kind: "code", file: "leak.ts" } },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_REPO_REF", path: "scenes.0.refs.source" }),
    );
  }
});

test("bundle validation rejects code line ranges that cannot be compiled", () => {
  const repo = mkdtempSync(join(tmpdir(), "av-bundle-code-range-repo-"));
  writeFileSync(join(repo, "source.ts"), "export const first = 1;\nexport const second = 2;\n");
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-code-range-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Code ranges", repo: { path: repo } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: {
            backwards: { kind: "code", file: "source.ts", lineStart: 2, lineEnd: 1 },
            pastEnd: { kind: "code", file: "source.ts", lineStart: 3, lineEnd: 4 },
          },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_REPO_REF",
        path: "scenes.0.refs.backwards",
        message: expect.stringContaining("Invalid line range 2-1"),
        hint: expect.stringContaining("valid line range"),
      }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_REPO_REF",
        path: "scenes.0.refs.pastEnd",
        message: expect.stringContaining("starts past end"),
      }),
    );
  }
});

test("bundle validation rejects asset parent symlink escapes and directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-asset-safety-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "assets", "folder"));
  symlinkSync("/etc", join(dir, "assets", "outside"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Asset safety", repo: { path: ROOT } },
      assets: {
        escaped: { type: "data", src: "assets/outside/hosts" },
        directory: { type: "data", src: "assets/folder" },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_ASSET_PATH", path: "assets.escaped.src" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_ASSET_PATH", path: "assets.directory.src" }),
    );
  }
});

test("line caption is rejected because subtitles come from narration text", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-caption-reject-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Caption reject", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Exact spoken line.", caption: "Short visual label." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "SCHEMA_ERROR",
        path: "scenes.0.narration.lines.0",
      }),
    );
  }
});

test("web propsSchema array constraints do not require item schemas", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "Array props", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html", props: { steps: [] } })],
  });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(
    join(dir, "web", "app.html"),
    webHtml({
      propsSchema: {
        type: "object",
        properties: { steps: { type: "array", minItems: 1 } },
      },
      inputs: {},
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_WEB_PROPS", path: "scenes.0.visual.props.steps" }),
    );
  }
});

test("web propsSchema dialect errors point at the HTML visual", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "Props dialect", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html", props: { title: "hello" } })],
  });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(
    join(dir, "web", "app.html"),
    webHtml({
      propsSchema: {
        type: "object",
        properties: { title: { type: "string", format: "email" } },
      },
      inputs: {},
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_WEB_SCHEMA", path: "scenes.0.visual.src" }),
    );
  }
});

test("web propsSchema rejects unknown types and non-schema child nodes", () => {
  for (const [name, propsSchema] of [
    ["unknown-type", { type: "banana" }],
    ["bad-child", { type: "object", properties: { title: "not-a-schema" } }],
  ] as const) {
    const dir = writeBundle({
      version: 3,
      meta: { title: name, repo: { path: ROOT } },
      scenes: [sceneWithVisual({ kind: "web", src: "web/app.html", props: { title: "hello" } })],
    });
    mkdirSync(join(dir, "web"), { recursive: true });
    writeFileSync(join(dir, "web", "app.html"), webHtml({ propsSchema, inputs: {} }));

    const result = validateBundle(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "BAD_WEB_SCHEMA", path: "scenes.0.visual.src" }),
      );
    }
  }
});

test("web policy lint ignores banned-looking strings and comments", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "Safe web source", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html" })],
  });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(
    join(dir, "web", "app.html"),
    [
      "<!doctype html><html><body>",
      '<script type="application/showtell+json">{"schemaVersion":3,"inputs":{}}</script>',
      "<script>",
      "// Date.now and Math.random are documentation text.",
      'const label = "fetch( process.cwd Date.now Math.random";',
      "const timeline = gsap.timeline({ paused: true });",
      "window.__showtell.timeline = timeline;",
      "</script></body></html>",
    ].join("\n"),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
});

function presenterSpec(presenter: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-presenter-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 3,
      meta: { title: "Presenter", presenter, repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Hello." }] },
          visual: screencapVisual(),
        },
      ],
    }),
  );
  return dir;
}

test("presenter defaults to enabled with auto position and md size", () => {
  const dir = presenterSpec({ image: "assets/avatar.png", model: "Claude" });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "avatar.png"), "png-bytes");

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.spec.meta.presenter).toMatchObject({
      enabled: true,
      image: "assets/avatar.png",
      model: "Claude",
      position: "auto",
      size: "md",
    });
  }
});

test("presenter validation reports missing image files with a repair hint", () => {
  const dir = presenterSpec({ image: "assets/avatar.png", logo: "assets/logo.png" });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.png"), "png-bytes");

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const error = result.errors.find((item) => item.code === "MISSING_PRESENTER_IMAGE");
    expect(error?.path).toBe("meta.presenter.image");
    expect(error?.hint).toContain("meta.presenter.enabled");
  }
});

test("disabled presenter skips image checks; escaping paths are rejected", () => {
  const disabled = presenterSpec({ enabled: false, image: "assets/missing.png" });
  expect(validateBundle(disabled).ok).toBe(true);

  const escaping = presenterSpec({ image: "../outside.png" });
  const result = validateBundle(escaping);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((item) => item.code === "BAD_PRESENTER_IMAGE_PATH")).toBe(true);
  }
});

test("bundle validation reports an actionable migration error for version 2", () => {
  const dir = writeBundle({
    version: 2,
    meta: { title: "Old bundle", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "builtin", name: "title", props: { title: "Old" } })],
  });

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_BUNDLE_VERSION",
        path: "version",
        hint: expect.stringContaining('visual.kind="web"'),
      }),
    );
  }
});

test("bundle v3 rejects removed builtins with an actionable browser migration", () => {
  const builtin = writeBundle({
    version: 3,
    meta: { title: "Builtin", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "builtin", name: "title", props: { title: "Hello" } })],
  });

  const result = validateBundle(builtin);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_VISUAL_KIND",
        path: "scenes.0.visual.kind",
        hint: expect.stringMatching(/<st-code>.*<st-diff>.*<st-chart>.*bundle templates/),
      }),
    ]);
  }
});

test("bundle v3 accepts web as its only designed visual runtime", () => {
  const web = writeBundle({
    version: 3,
    meta: { title: "Web", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html" })],
  });
  mkdirSync(join(web, "web"), { recursive: true });
  writeFileSync(join(web, "web", "app.html"), webHtml({ inputs: {} }));
  expect(validateBundle(web).ok).toBe(true);
});

test("bundle v3 web visuals must assign the paused showtell timeline", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "No timeline", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html" })],
  });
  mkdirSync(join(dir, "web"), { recursive: true });
  const html = webHtml({ inputs: {} }).replace(
    "<script>window.__showtell.timeline = gsap.timeline({ paused: true });</script>",
    "",
  );
  writeFileSync(join(dir, "web", "app.html"), html);
  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MISSING_WEB_TIMELINE" }));
  }
});

test("bundle v3 screencap keeps simple-spec validation semantics", () => {
  for (const visual of [
    { kind: "screencap", sessionRef: "../recording" },
    { kind: "screencap", sessionRef: "recording", clip: { start: 2, end: 1 } },
    { kind: "screencap", sessionRef: "recording", playback: { mode: "warp-speed" } },
  ]) {
    const dir = writeBundle({
      version: 3,
      meta: { title: "Bad screencap", repo: { path: ROOT } },
      scenes: [sceneWithVisual(visual)],
    });
    const result = validateBundle(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "SCHEMA_ERROR", path: expect.stringContaining("scenes.0.visual") }),
      );
    }
  }
});

test("bundle v3 web inputs accept repo, asset, and range bindings", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "v3 bindings", repo: { path: ROOT } },
    assets: { metrics: { type: "data", src: "assets/metrics.json" } },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "Intro." }] },
        refs: { source: { kind: "code", file: "README.md", lineStart: 1, lineEnd: 3 } },
        ranges: { reveal: "line:l1" },
        visual: {
          kind: "web",
          src: "web/app.html",
          props: { title: "Repo proof" },
          inputs: { source: "source", metrics: "metrics", reveal: "reveal" },
        },
      },
    ],
  });
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(join(dir, "assets", "metrics.json"), "{}");
  writeFileSync(
    join(dir, "web", "app.html"),
    webHtml({
      propsSchema: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", minLength: 3 } },
      },
      inputs: {
        source: { kind: "repo", refKind: "code" },
        metrics: { kind: "asset", assetType: "data" },
        reveal: { kind: "range" },
      },
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
});

test("bundle v3 web manifest errors are precise for missing duplicate malformed and wrong-version manifests", () => {
  const cases: Array<[string, string, string]> = [
    ["missing", "<main>No manifest</main>", "MISSING_WEB_MANIFEST"],
    [
      "duplicate",
      `${webHtml({ inputs: {} })}<script type="application/showtell+json">{"schemaVersion":3}</script>`,
      "DUPLICATE_WEB_MANIFEST",
    ],
    ["malformed", '<script type="application/showtell+json">{"schemaVersion":3,</script>', "INVALID_WEB_MANIFEST_JSON"],
    ["wrong-version", webHtml({ schemaVersion: 2, inputs: {} }), "WRONG_WEB_MANIFEST_VERSION"],
  ];

  for (const [name, html, code] of cases) {
    const dir = writeBundle({
      version: 3,
      meta: { title: name, repo: { path: ROOT } },
      scenes: [sceneWithVisual({ kind: "web", src: "web/app.html" })],
    });
    mkdirSync(join(dir, "web"), { recursive: true });
    writeFileSync(join(dir, "web", "app.html"), html);

    const result = validateBundle(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code, path: "scenes.0.visual.src", hint: expect.any(String) }),
      );
    }
  }
});

test("bundle v3 web validation rejects bad bindings and props", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "bad web", repo: { path: ROOT } },
    assets: { logo: { type: "image", src: "assets/logo.png" } },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "Intro." }] },
        refs: { diff: { kind: "diff", file: "README.md", ref: "HEAD" } },
        visual: {
          kind: "web",
          src: "web/app.html",
          props: { title: "x" },
          inputs: {
            source: "diff",
            metrics: "logo",
            extra: "line:l1",
          },
        },
      },
    ],
  });
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(join(dir, "assets", "logo.png"), "png");
  writeFileSync(
    join(dir, "web", "app.html"),
    webHtml({
      propsSchema: {
        type: "object",
        required: ["title"],
        properties: { title: { type: "string", minLength: 3 } },
      },
      inputs: {
        source: { kind: "repo", refKind: "code" },
        metrics: { kind: "asset", assetType: "data" },
        reveal: { kind: "range" },
      },
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BAD_WEB_PROPS" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "UNKNOWN_WEB_INPUT" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MISSING_WEB_INPUT" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "WRONG_REPO_REF_KIND" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "WRONG_ASSET_TYPE" }));
  }
});

test("bundle v3 web policy rejects ambient motion, network resources, and nondeterministic APIs", () => {
  const dir = writeBundle({
    version: 3,
    meta: { title: "unsafe web", repo: { path: ROOT } },
    scenes: [sceneWithVisual({ kind: "web", src: "web/app.html" })],
  });
  mkdirSync(join(dir, "web"), { recursive: true });
  writeFileSync(
    join(dir, "web", "app.html"),
    [
      "<!doctype html><html><head>",
      '<script type="application/showtell+json">{"schemaVersion":3,"inputs":{}}</script>',
      "<style>.orb{animation:pulse 1s infinite;background:url(https://example.com/bg.png)}</style>",
      '<script src="https://example.com/ambient.js"></script>',
      "</head><body>",
      '<img src="https://example.com/photo.png" onclick="fetch(\'https://example.com\')">',
      '<svg><animateMotion dur="1s" repeatCount="indefinite"></animateMotion></svg>',
      "<script>const n = Math.random(); setTimeout(() => n, 10); crypto.getRandomValues(new Uint8Array(1)); crypto.randomUUID(); document.body.animate([], {duration: 1000});</script>",
      "</body></html>",
    ].join(""),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BANNED_WEB_RESOURCE" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BANNED_WEB_HANDLER" }));
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BANNED_WEB_CSS" }));
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_WEB_API", message: expect.stringContaining("Math.random") }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_WEB_API", message: expect.stringContaining("setTimeout") }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_WEB_API", message: expect.stringContaining("crypto.getRandomValues") }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_WEB_API", message: expect.stringContaining("crypto.randomUUID") }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_WEB_API", message: expect.stringContaining("Element.animate") }),
    );
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "BANNED_WEB_ANIMATION" }));
  }
});

test("explicit scene duration validates against the minimum frame budget", () => {
  const valid = writeBundle({
    version: 3,
    meta: { title: "Exact media", fps: 30, repo: { path: ROOT } },
    scenes: [
      {
        id: "capture",
        duration: 0.5,
        narration: { lines: [{ id: "l1", text: "Exact." }] },
        visual: screencapVisual(),
      },
    ],
  });
  expect(validateBundle(valid).ok).toBe(true);

  const tooShort = writeBundle({
    version: 3,
    meta: { title: "Too short", fps: 30, repo: { path: ROOT } },
    scenes: [
      {
        id: "capture",
        duration: 0.01,
        narration: { lines: [{ id: "l1", text: "Exact." }] },
        visual: screencapVisual(),
      },
    ],
  });
  const result = validateBundle(tooShort);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_EXPLICIT_DURATION", path: "scenes.0.duration" }),
    );
  }
});

test("published bundle schema exposes v3 web visuals and screencap media only", () => {
  const schemaPath = join(ROOT, "packages", "core", "bundle.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const text = JSON.stringify(schema);
  expect(text).toContain('"version"');
  expect(text).toContain('"const":3');
  expect(text).toContain('"web"');
  expect(text).toContain('"screencap"');
  expect(text).toContain('"sessionRef"');
  expect(text).toContain('"playback"');
  expect(text).not.toContain('"builtin"');
  expect(text).not.toContain('"const":2');
  expect(text).not.toContain('"hyperframe"');
});

function writeBundle(spec: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-v3-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  return dir;
}

function sceneWithVisual(visual: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "intro",
    narration: { lines: [{ id: "l1", text: "Intro." }] },
    visual,
  };
}

function screencapVisual(): Record<string, unknown> {
  return { kind: "screencap", sessionRef: "fixture" };
}

function webHtml(manifest: Record<string, unknown>): string {
  return [
    '<!doctype html><html><body><div id="root"></div>',
    `<script type="application/showtell+json">${JSON.stringify({ schemaVersion: 3, ...manifest })}</script>`,
    "<script>window.__showtell.timeline = gsap.timeline({ paused: true });</script>",
    "</body></html>",
  ].join("");
}
