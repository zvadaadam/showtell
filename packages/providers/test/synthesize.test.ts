import { test, expect, afterAll } from "bun:test";
import { chmodSync, existsSync, rmSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesize, availableTtsProviders, probeDurationMs } from "../src/index.ts";

const cacheDir = mkdtempSync(join(tmpdir(), "av-tts-"));
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

function ttsCachePath(text: string, dir = cacheDir): string {
  const key = createHash("sha256")
    .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
    .digest("hex")
    .slice(0, 32);
  return join(dir, `say-${key}.wav`);
}

function headerOnlyWav(): Buffer {
  const buffer = Buffer.alloc(78);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44_100, 24);
  buffer.writeUInt32LE(88_200, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(0, 40);
  return buffer;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

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
  const wav = ttsCachePath(text);
  writeFileSync(wav, "not a wav");
  const r = await synthesize({ text }, { cacheDir });
  expect(r.cached).toBe(false);
  expect(probeDurationMs(r.wavPath)).toBeGreaterThan(0);
}, 30_000);

test("an invalid header-only cache hit is discarded before reuse", async () => {
  const text = "regenerate header-only cache.";
  const wav = ttsCachePath(text);
  writeFileSync(wav, headerOnlyWav());

  try {
    const r = await synthesize({ text }, { cacheDir });
    expect(r.cached).toBe(false);
    expect(probeDurationMs(r.wavPath)).toBeGreaterThan(0);
    expect(statSync(r.wavPath).size).toBeGreaterThan(78);
  } catch (e) {
    expect((e as Error).message).toContain('produced an invalid or empty wav for line "regenerate header-only cache."');
    expect((e as Error).message).toContain("nothing was cached");
  }

  if (existsSync(wav)) {
    expect(statSync(wav).size).toBeGreaterThan(78);
  }
}, 30_000);

test("invalid fresh synthesis is rejected before it reaches the cache", async () => {
  if (process.platform !== "darwin") return;

  const text = "fresh invalid synthesis.";
  const localCacheDir = mkdtempSync(join(tmpdir(), "av-tts-invalid-"));
  const binDir = mkdtempSync(join(tmpdir(), "av-tts-bin-"));
  const invalidWav = join(binDir, "invalid.wav");
  const fixturePath = join(import.meta.dir, "fixtures", "run-synthesize.ts");

  try {
    writeFileSync(invalidWav, headerOnlyWav());
    writeFileSync(
      join(binDir, "say"),
      `#!/bin/sh
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  fi
  shift
done
printf fake > "$out"
`,
    );
    writeFileSync(
      join(binDir, "ffmpeg"),
      `#!/bin/sh
out=""
for arg in "$@"; do
  out="$arg"
done
cp ${shellQuote(invalidWav)} "$out"
`,
    );
    chmodSync(join(binDir, "say"), 0o755);
    chmodSync(join(binDir, "ffmpeg"), 0o755);

    const result = Bun.spawnSync(["bun", fixturePath, text, localCacheDir], {
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    });
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(stderr).toContain(
      'TTS provider "say" produced an invalid or empty wav for line "fresh invalid synthesis." - nothing was cached. Check that speech synthesis works in this environment (e.g. run: say -o /tmp/test.wav "hello").',
    );
    expect(existsSync(ttsCachePath(text, localCacheDir))).toBe(false);
  } finally {
    rmSync(localCacheDir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
}, 30_000);

test("stale temp cache files are ignored", async () => {
  const text = "ignore temp cache.";
  writeFileSync(`${ttsCachePath(text)}.tmp.wav`, "partial");
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
