#!/usr/bin/env bun
/** Regenerate the published JSON Schemas from their Zod sources. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleSpecJsonSchema, videoSpecJsonSchema, videoManifestJsonSchema } from "@showtell/core";

const root = join(import.meta.dir, "..");
const coreDir = join(root, "packages", "core");
const specOut = join(coreDir, "schema.json");
const manifestOut = join(coreDir, "manifest.schema.json");
const bundleOut = join(coreDir, "bundle.schema.json");

const artifacts = [
  { path: specOut, content: JSON.stringify(videoSpecJsonSchema(), null, 2) + "\n" },
  { path: manifestOut, content: JSON.stringify(videoManifestJsonSchema(), null, 2) + "\n" },
  { path: bundleOut, content: JSON.stringify(bundleSpecJsonSchema(), null, 2) + "\n" },
];

if (process.argv.includes("--check")) {
  const stale = artifacts.filter(
    (artifact) => !existsSync(artifact.path) || readFileSync(artifact.path, "utf-8") !== artifact.content,
  );
  if (stale.length > 0) {
    process.stderr.write(
      JSON.stringify(
        {
          ok: false,
          error: "Generated schemas are stale.",
          hint: "Run `bun run gen:schema` and commit the updated schema files.",
          stale: stale.map((artifact) => artifact.path),
        },
        null,
        2,
      ) + "\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({ ok: true, checked: artifacts.map((artifact) => artifact.path) }, null, 2) + "\n",
  );
} else {
  for (const artifact of artifacts) writeFileSync(artifact.path, artifact.content);
  process.stdout.write(JSON.stringify({ ok: true, wrote: artifacts.map((artifact) => artifact.path) }, null, 2) + "\n");
}
