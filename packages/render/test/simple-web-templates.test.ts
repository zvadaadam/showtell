import { describe, expect, test } from "bun:test";
import { loadWebManifestFromSource, validateWebSource, type BundleError } from "@showtell/core";
import { validateJsonSchemaValue } from "../../core/src/props-schema.ts";
import {
  simpleWebDocument,
  simpleWebManifest,
  simpleWebProps,
  type SimpleWebScene,
} from "../src/simple-web-templates.ts";

const COPY_MARKER = "COPY__STAYS__IN__PROPS";
const DATA_MARKER = "DATA__STAYS__IN__ASSET";

const scenes: SimpleWebScene[] = [
  {
    kind: "title",
    narration: "Open the chapter.",
    duration: "auto",
    content: { heading: COPY_MARKER, subtitle: "One deterministic motion clock" },
  },
  {
    kind: "code",
    narration: "Read the source live.",
    duration: "auto",
    content: { file: `src/${COPY_MARKER}.ts`, lineStart: 2, lineEnd: 18, focus: [9] },
  },
  {
    kind: "diff",
    narration: "Reveal the change.",
    duration: "auto",
    content: { file: `src/${COPY_MARKER}.ts`, ref: "main..HEAD", animation: "magic-move" },
  },
  {
    kind: "talking-points",
    narration: "Trace the important ideas.",
    duration: "auto",
    content: { heading: "Review path", points: [COPY_MARKER, "Then verify exact frames"] },
  },
  {
    kind: "chart",
    narration: "Let the data move.",
    duration: "auto",
    content: {
      chartType: "bar",
      title: COPY_MARKER,
      x: "month",
      y: "value",
      data: [
        { month: DATA_MARKER, value: 12 },
        { month: "Jul", value: 28 },
      ],
    },
  },
];

describe("simple browser HyperFrame generators", () => {
  test.each(scenes)("$kind document has one valid, deterministic motion contract", (scene) => {
    const source = simpleWebDocument(scene);
    const manifest = loadWebManifestFromSource(source);
    const errors: BundleError[] = [];
    validateWebSource(source, `${scene.kind}.html`, errors);

    expect(source.startsWith("<!doctype html>")).toBe(true);
    expect(source).toContain("@media (max-aspect-ratio: 4 / 5)");
    expect(source).toContain('st.range("reveal")');
    expect(source).toContain("window.__showtell.timeline = timeline;");
    expect(source.match(/gsap\.timeline\(\{ paused: true \}\)/g)).toHaveLength(1);
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain(COPY_MARKER);
    expect(source).not.toContain(DATA_MARKER);
    expect(errors).toEqual([]);

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.inputs.reveal).toEqual({ kind: "range", optional: false });
    expect(manifest.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(simpleWebManifest(scene)).toEqual({
      schemaVersion: manifest.schemaVersion,
      propsSchema: manifest.propsSchema,
      inputs: Object.fromEntries(
        Object.entries(manifest.inputs).map(([name, input]) => {
          const { optional: _optional, ...contract } = input;
          return [name, contract];
        }),
      ),
    });
    expect(validateJsonSchemaValue(manifest.propsSchema, simpleWebProps(scene), "props")).toEqual([]);
  });

  test("repo and data scenes declare typed ports without embedding resolved bytes", () => {
    const code = scenes.find((scene) => scene.kind === "code")!;
    const diff = scenes.find((scene) => scene.kind === "diff")!;
    const chart = scenes.find((scene) => scene.kind === "chart")!;

    expect(loadWebManifestFromSource(simpleWebDocument(code)).inputs).toMatchObject({
      source: { kind: "repo", refKind: "code", optional: false },
      reveal: { kind: "range", optional: false },
    });
    expect(simpleWebDocument(code)).toContain(
      '<st-code input="source" reveal-range="reveal" max-lines="22"></st-code>',
    );

    expect(loadWebManifestFromSource(simpleWebDocument(diff)).inputs).toMatchObject({
      source: { kind: "repo", refKind: "diff", optional: false },
      reveal: { kind: "range", optional: false },
    });
    expect(simpleWebDocument(diff)).toContain(
      '<st-diff input="source" reveal-range="reveal" max-lines="22"></st-diff>',
    );

    expect(loadWebManifestFromSource(simpleWebDocument(chart)).inputs).toMatchObject({
      data: { kind: "asset", assetType: "data", optional: false },
      reveal: { kind: "range", optional: false },
    });
    const chartSource = simpleWebDocument(chart);
    expect(chartSource).toContain('<st-chart input="data" reveal-range="reveal"></st-chart>');
    for (const attribute of ["type", "x", "y", "title"]) {
      expect(chartSource).toContain(`chart.setAttribute("${attribute}"`);
    }
    expect(chartSource.indexOf('chart.setAttribute("title"')).toBeLessThan(
      chartSource.indexOf("window.__showtell.timeline = timeline;"),
    );
  });

  test("props helpers preserve the simple scene meaning exactly", () => {
    expect(simpleWebProps(scenes[0]!)).toEqual({
      heading: COPY_MARKER,
      subtitle: "One deterministic motion clock",
    });
    expect(simpleWebProps(scenes[1]!)).toEqual({ file: `src/${COPY_MARKER}.ts` });
    expect(simpleWebProps(scenes[2]!)).toEqual({
      file: `src/${COPY_MARKER}.ts`,
      ref: "main..HEAD",
      animation: "magic-move",
    });
    expect(simpleWebProps(scenes[3]!)).toEqual({
      heading: "Review path",
      points: [COPY_MARKER, "Then verify exact frames"],
    });
    expect(simpleWebProps(scenes[4]!)).toEqual({
      chartType: "bar",
      title: COPY_MARKER,
      x: "month",
      y: "value",
    });
  });
});
