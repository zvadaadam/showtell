import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoManifest, VideoSpec } from "@showtell/core";
import { renderVideo } from "../src/index.ts";

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ttsCachePath(cacheDir: string, text: string): string {
  const key = createHash("sha256")
    .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
    .digest("hex")
    .slice(0, 32);
  return join(cacheDir, "tts", `say-${key}.wav`);
}

function silentWav(durationMs: number): Buffer {
  const sampleRate = 44_100;
  const channelCount = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.round((sampleRate * durationMs) / 1000);
  const dataBytes = sampleCount * channelCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function readManifest(path: string): VideoManifest {
  return JSON.parse(readFileSync(path, "utf-8")) as VideoManifest;
}

const spec: VideoSpec = {
  meta: {
    title: "determinism",
    fps: 30,
    aspectRatios: ["16:9"],
    watermark: true,
    tts: { provider: "say" },
    repo: { path: "." },
  },
  scenes: [
    { kind: "title", content: { heading: "Alpha" }, narration: "alpha.", duration: "auto" },
    { kind: "title", content: { heading: "Beta" }, narration: "beta.", duration: "auto" },
  ],
};

test("CONTRACT: rendering the same spec twice produces byte-identical mp4 output", async () => {
  const root = mkdtempSync(join(tmpdir(), "showtell-determinism-"));
  const cacheDir = join(root, "cache");
  const firstOutDir = join(root, "first");
  const secondOutDir = join(root, "second");
  mkdirSync(join(cacheDir, "tts"), { recursive: true });
  writeFileSync(ttsCachePath(cacheDir, "alpha."), silentWav(500));
  writeFileSync(ttsCachePath(cacheDir, "beta."), silentWav(500));

  try {
    const first = await renderVideo(spec, {
      repoPath: ".",
      outDir: firstOutDir,
      baseName: "determinism",
      aspectRatios: ["16:9"],
      cacheDir,
    });
    const second = await renderVideo(spec, {
      repoPath: ".",
      outDir: secondOutDir,
      baseName: "determinism",
      aspectRatios: ["16:9"],
      cacheDir,
    });

    const firstOutput = first.outputs[0]!;
    const secondOutput = second.outputs[0]!;
    expect(existsSync(firstOutput.path)).toBe(true);
    expect(existsSync(secondOutput.path)).toBe(true);
    expect(statSync(firstOutput.path).size).toBeGreaterThan(10_000);
    expect(statSync(secondOutput.path).size).toBeGreaterThan(10_000);
    expect(hashFile(secondOutput.path)).toBe(hashFile(firstOutput.path));
    expect(readManifest(second.manifestPath)).toEqual(readManifest(first.manifestPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
