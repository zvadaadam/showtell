import { test, expect, afterAll } from "bun:test";
import { existsSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

test("a corrupt final cache file is regenerated", async () => {
  const text = "regenerate corrupt cache.";
  const key = createHash("sha256")
    .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
    .digest("hex")
    .slice(0, 32);
  const wav = join(cacheDir, `say-${key}.wav`);
  writeFileSync(wav, "not a wav");
  const r = await synthesize({ text }, { cacheDir });
  expect(r.cached).toBe(false);
  expect(probeDurationMs(r.wavPath)).toBeGreaterThan(0);
}, 30_000);

test("stale temp cache files are ignored", async () => {
  const text = "ignore temp cache.";
  const key = createHash("sha256")
    .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
    .digest("hex")
    .slice(0, 32);
  writeFileSync(join(cacheDir, `say-${key}.wav.tmp.wav`), "partial");
  const r = await synthesize({ text }, { cacheDir });
  expect(r.cached).toBe(false);
  expect(existsSync(r.wavPath)).toBe(true);
}, 30_000);

test("replicate and elevenlabs adapters are wired but require environment credentials", async () => {
  expect(availableTtsProviders()).toContain("replicate");
  expect(availableTtsProviders()).toContain("elevenlabs");

  const savedReplicate = process.env.REPLICATE_API_TOKEN;
  const savedEleven = process.env.ELEVENLABS_API_KEY;
  const savedElevenAlt = process.env.ELEVEN_LABS_API_KEY;
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVEN_LABS_API_KEY;
  try {
    await expect(
      synthesize({ text: "x", model: "owner/model:version" }, { provider: "replicate", cacheDir }),
    ).rejects.toThrow(/REPLICATE_API_TOKEN/);
    await expect(synthesize({ text: "x", voice: "voice-id" }, { provider: "elevenlabs", cacheDir })).rejects.toThrow(
      /ELEVENLABS_API_KEY/,
    );
  } finally {
    if (savedReplicate !== undefined) process.env.REPLICATE_API_TOKEN = savedReplicate;
    if (savedEleven !== undefined) process.env.ELEVENLABS_API_KEY = savedEleven;
    if (savedElevenAlt !== undefined) process.env.ELEVEN_LABS_API_KEY = savedElevenAlt;
  }
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
