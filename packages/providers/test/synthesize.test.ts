import { test, expect, afterAll } from "bun:test";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize, availableTtsProviders, probeDurationMs } from "../src/index.ts";

const cacheDir = mkdtempSync(join(tmpdir(), "av-tts-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

test('"say" is an available provider', () => {
  expect(availableTtsProviders()).toContain("say");
});

test("synthesize writes a wav with a real duration (cache miss)", async () => {
  const r = await synthesize({ text: "one two three four." }, { cacheDir });
  expect(r.cached).toBe(false);
  expect(existsSync(r.wavPath)).toBe(true);
  expect(r.durationMs).toBeGreaterThan(0);
  expect(probeDurationMs(r.wavPath)).toBe(r.durationMs);
}, 30_000);

test("the same request is served from the per-line cache (cache hit)", async () => {
  const a = await synthesize({ text: "cache me once." }, { cacheDir });
  expect(a.cached).toBe(false);
  const b = await synthesize({ text: "cache me once." }, { cacheDir });
  expect(b.cached).toBe(true);
  expect(b.wavPath).toBe(a.wavPath);
}, 30_000);

test("changing the text busts the cache key", async () => {
  const a = await synthesize({ text: "alpha." }, { cacheDir });
  const b = await synthesize({ text: "beta." }, { cacheDir });
  expect(b.wavPath).not.toBe(a.wavPath);
}, 30_000);

test("an unknown provider throws an actionable error", async () => {
  await expect(synthesize({ text: "x" }, { provider: "replicate", cacheDir })).rejects.toThrow(/not available/);
});

test('"openai" has an adapter but errors without an env key (key never from the spec)', async () => {
  expect(availableTtsProviders()).toContain("openai");
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await expect(synthesize({ text: "no key here please." }, { provider: "openai", cacheDir })).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
  } finally {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  }
});
