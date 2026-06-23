import { test, expect } from "bun:test";
import { validateSpec, videoSpecJsonSchema } from "../src/index.ts";

const good = {
  meta: { title: "t", aspectRatios: ["16:9"] },
  scenes: [
    { kind: "title", content: { heading: "h" }, narration: "hi" },
    { kind: "code", content: { file: "packages/core/src/spec.ts", lineStart: 1, lineEnd: 5 }, narration: "code" },
  ],
};

test("valid spec passes and applies defaults", () => {
  const r = validateSpec(good);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.spec.meta.fps).toBe(30); // default
    expect(r.spec.scenes[0]!.duration).toBe("auto"); // default
    expect(r.warnings).toHaveLength(0);
  }
});

test("unknown scene kind fails with a path", () => {
  const r = validateSpec({ ...good, scenes: [{ kind: "nope", content: {}, narration: "x" }] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors[0]!.path).toContain("kind");
});

test("empty narration is rejected with a hint", () => {
  const r = validateSpec({ ...good, scenes: [{ kind: "title", content: { heading: "h" }, narration: "" }] });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.errors.some((e) => e.hint?.includes("narration"))).toBe(true);
});

test("pasted-extra keys are rejected (strict)", () => {
  const r = validateSpec({ ...good, scenes: [{ kind: "title", content: { heading: "h", src: "paste" }, narration: "x" }] });
  expect(r.ok).toBe(false);
});

test("a not-yet-renderable kind validates but warns", () => {
  const r = validateSpec({
    ...good,
    scenes: [{ kind: "screencap", content: { source: "app" }, narration: "x" }],
  });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.warnings[0]!.path).toContain("kind");
});

test("json schema generates", () => {
  expect(videoSpecJsonSchema()).toHaveProperty("definitions");
});
