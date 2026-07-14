import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { webStarterTemplates } from "../src/web-authoring.ts";

test("the v3 starter and runnable canonical example cannot drift", () => {
  const example = readFileSync(
    join(import.meta.dir, "..", "..", "..", "examples", "bundle-v3", "hyperframes", "live-proof.html"),
    "utf-8",
  );
  expect(webStarterTemplates).toHaveLength(1);
  expect(webStarterTemplates[0]!.source).toBe(example);
});
