import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBundleTheme, validateBundle } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

test("bundle v2 example validates with assets, refs, and hyperframes", () => {
  const result = validateBundle(join(ROOT, "examples", "bundle-v2"));
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.spec.version).toBe(2);
    expect(result.spec.scenes).toHaveLength(5);
    expect(result.spec.scenes.map((scene) => scene.id)).toEqual([
      "overview",
      "authoring",
      "compile",
      "render",
      "proof",
    ]);
    expect(Object.keys(result.spec.assets)).toContain("metrics");
    expect(result.warnings).toHaveLength(0);
  }
});

test("bundle validation reports actionable missing asset errors", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-invalid-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Bad", repo: { path: ROOT } },
      assets: { missing: { type: "data", src: "assets/missing.json" } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Hello." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Hi" } },
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
      version: 2,
      meta: { title: "Time refs", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
        },
        {
          id: "proof",
          narration: { lines: [{ id: "l1", text: "Proof." }] },
          ranges: { full: { from: "scene:intro@start", to: "scene:proof@end" } },
          visual: { kind: "builtin", name: "title", props: { title: "Proof" } },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
});

test("bundle validation accepts semantic theme presets and partial overrides", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
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
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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

test("bundle validation still accepts a full explicit semantic theme", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-full-theme-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: {
        title: "Full theme",
        repo: { path: ROOT },
        theme: {
          mode: "paper",
          colors: {
            fg: "#191b29",
            bg: "#f7f4ec",
            subtle: "#5d6275",
            accent: "#2563eb",
            success: "#2ea043",
            warning: "#b45309",
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
        },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.spec.meta.theme?.mode).toBe("paper");
});

test("bundle validation rejects non-hex theme colors and CSS font stacks", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-bad-theme-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: {
        title: "Bad theme",
        repo: { path: ROOT },
        theme: {
          preset: "agent-dark",
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
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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
      version: 2,
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
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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

test("bundle validation rejects conflicting preset and mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-conflict-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: {
        title: "Theme conflict",
        repo: { path: ROOT },
        theme: { preset: "paper", mode: "dark" },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors).toContainEqual(expect.objectContaining({ code: "CONFLICTING_THEME_MODE" }));
});

test("bundle validation warns on unregistered theme fonts", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-theme-font-warning-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: {
        title: "Theme font",
        repo: { path: ROOT },
        theme: { preset: "agent-dark", typography: { body: "Aptos" } },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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
  expect(text).toContain('"agent-dark"');
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
      version: 2,
      meta: { title: "Bad music range", repo: { path: ROOT } },
      assets: { bed: { type: "audio", src: "assets/bed.wav" } },
      audio: { music: [{ id: "bed", asset: "bed", range: "scene:nope" }] },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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
      version: 2,
      meta: { title: "Git option", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: { diff: { kind: "diff", file: "README.md", ref: "--output=/tmp/agent-video-pwned" } },
          visual: { kind: "builtin", name: "diff", ref: "diff" },
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
      version: 2,
      meta: { title: "Code symlink", repo: { path: repo } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: { source: { kind: "code", file: "leak.ts" } },
          visual: { kind: "builtin", name: "code", ref: "source" },
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

test("bundle validation rejects asset parent symlink escapes and directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-asset-safety-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "assets", "folder"));
  symlinkSync("/etc", join(dir, "assets", "outside"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Asset safety", repo: { path: ROOT } },
      assets: {
        escaped: { type: "data", src: "assets/outside/hosts" },
        directory: { type: "data", src: "assets/folder" },
      },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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
      version: 2,
      meta: { title: "Caption reject", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Exact spoken line.", caption: "Short visual label." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Intro" } },
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

test("hyperframe inputs come from the module contract, not copied JSON bindings", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-binding-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "source.tsx"),
    [
      'const propsSchema = { type: "object", properties: { source: { type: "string" } } };',
      'const inputs = { source: { kind: "repo", refKind: "code" } };',
      "function render() { return null; }",
      "export default { schemaVersion: 1, propsSchema, inputs, render };",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Explicit inputs", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          refs: {},
          visual: {
            kind: "hyperframe",
            src: "hyperframes/source.tsx",
            inputs: { source: "missing" },
            props: { source: "not a ref" },
          },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_REPO_REF", path: "scenes.0.visual.inputs.source" }),
    );
  }
});

test("hyperframe propsSchema supported constraints are enforced", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-props-schema-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "source.tsx"),
    [
      'const propsSchema = { type: "object", required: ["title"], properties: { title: { type: "string", minLength: 5 } } };',
      "const inputs = {};",
      "function render() { return null; }",
      "export default { schemaVersion: 1, propsSchema, inputs, render };",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Props schema", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/source.tsx",
            props: { title: "x" },
          },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BAD_HYPERFRAME_PROPS", path: "scenes.0.visual.props.title" }),
    );
  }
});

test("hyperframe contract must come from the default export object", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-default-export-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "source.tsx"),
    [
      'const propsSchema = { type: "object", properties: { title: { type: "string" } } };',
      "const inputs = {};",
      "function render() { return null; }",
      "export default null;",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Bad export", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Intro." }] },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/source.tsx",
            props: { title: "Hello" },
          },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "INVALID_HYPERFRAME_CONTRACT", path: "scenes.0.visual.src" }),
    );
  }
});

test("hyperframe policy lint rejects ambient APIs and unsupported imports", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-hyperframe-policy-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "unsafe.tsx"),
    [
      'import { readFileSync } from "node:fs";',
      'const propsSchema = { type: "object", properties: { title: { type: "string" } } };',
      "const inputs = {};",
      "function render() {",
      "  process.cwd();",
      "  readFileSync('/etc/hosts', 'utf-8');",
      "  return null;",
      "}",
      "export default { schemaVersion: 1, propsSchema, inputs, render };",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Unsafe hyperframe", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Unsafe APIs should fail validation." }] },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/unsafe.tsx",
            props: { title: "Unsafe" },
          },
        },
      ],
    }),
  );

  const result = validateBundle(dir);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "BANNED_HYPERFRAME_IMPORT", path: "scenes.0.visual.src" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "BANNED_HYPERFRAME_API",
        path: "scenes.0.visual.src",
        message: expect.stringContaining("process."),
      }),
    );
  }
});
