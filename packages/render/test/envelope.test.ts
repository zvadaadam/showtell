import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { amplitudeAt, ENVELOPE_WINDOW_MS, extractAmplitudeEnvelope } from "../src/envelope.ts";

/** 0.5s silence followed by 0.5s of a 440 Hz tone. */
function toneAfterSilenceWav(): string {
  const dir = mkdtempSync(join(tmpdir(), "av-envelope-"));
  const path = join(dir, "tone.wav");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(gte(t\\,0.5)\\,0.6*sin(880*PI*t)\\,0):s=44100:d=1",
    "-c:a",
    "pcm_s16le",
    path,
  ]);
  return path;
}

test("extractAmplitudeEnvelope tracks silence vs speech-level loudness", () => {
  const envelope = extractAmplitudeEnvelope(toneAfterSilenceWav());
  const windows = Math.round(1000 / ENVELOPE_WINDOW_MS);
  expect(Math.abs(envelope.length - windows)).toBeLessThanOrEqual(1);
  const firstHalf = envelope.slice(0, Math.floor(windows * 0.45));
  const secondHalf = envelope.slice(Math.ceil(windows * 0.55), windows - 1);
  expect(Math.max(...firstHalf)).toBeLessThan(0.05);
  expect(Math.min(...secondHalf)).toBeGreaterThan(0.9);
  expect(envelope.every((value) => value >= 0 && value <= 1)).toBe(true);
});

test("extractAmplitudeEnvelope is deterministic for the same audio", () => {
  const path = toneAfterSilenceWav();
  expect(extractAmplitudeEnvelope(path)).toEqual(extractAmplitudeEnvelope(path));
});

test("amplitudeAt interpolates between windows and clamps the edges", () => {
  expect(amplitudeAt(undefined, 100)).toBe(0);
  expect(amplitudeAt([], 100)).toBe(0);
  const envelope = [0, 1];
  expect(amplitudeAt(envelope, 0)).toBe(0);
  // Halfway between the two window centers (25ms and 75ms).
  expect(amplitudeAt(envelope, 50)).toBeCloseTo(0.5, 5);
  expect(amplitudeAt(envelope, 10_000)).toBe(1);
});
