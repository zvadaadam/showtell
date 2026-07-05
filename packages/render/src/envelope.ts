/**
 * Narration amplitude envelopes for audio-reactive overlays (presenter bubble).
 *
 * The compile pass decodes each narration line's TTS audio once and reduces it
 * to a coarse RMS envelope (one value per window, normalized 0..1). Frames then
 * sample the envelope deterministically — same audio, same pixels — so the
 * presenter pulse follows the real speech loudness instead of a fake sine.
 */
import { execFileSync } from "node:child_process";

export const ENVELOPE_WINDOW_MS = 50;

/** Decode rate for envelope analysis. Loudness needs no fidelity above 8 kHz. */
const ENVELOPE_SAMPLE_RATE = 8000;

/** RMS below this fraction of the line's peak counts as silence (noise gate). */
const SILENCE_FLOOR = 0.05;

/**
 * Reduce an audio file to a normalized loudness envelope: RMS per window,
 * noise-gated, then square-rooted so quiet speech still reads visually.
 */
export function extractAmplitudeEnvelope(audioPath: string, windowMs = ENVELOPE_WINDOW_MS): number[] {
  const pcm = execFileSync(
    "ffmpeg",
    ["-loglevel", "error", "-i", audioPath, "-f", "s16le", "-ac", "1", "-ar", String(ENVELOPE_SAMPLE_RATE), "pipe:1"],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const window = Math.max(1, Math.round((ENVELOPE_SAMPLE_RATE * windowMs) / 1000));
  const rms: number[] = [];
  for (let start = 0; start < samples.length; start += window) {
    const end = Math.min(samples.length, start + window);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const value = samples[i]! / 32768;
      sum += value * value;
    }
    rms.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  const peak = Math.max(0, ...rms);
  if (peak < 1e-4) return rms.map(() => 0);
  const floor = peak * SILENCE_FLOOR;
  return rms.map((value) => {
    const gated = Math.max(0, value - floor) / (peak - floor);
    return Math.round(Math.sqrt(gated) * 1000) / 1000;
  });
}

/** Sample an envelope at a line-relative time, interpolating between windows. */
export function amplitudeAt(
  envelope: readonly number[] | undefined,
  lineMs: number,
  windowMs = ENVELOPE_WINDOW_MS,
): number {
  if (!envelope || envelope.length === 0) return 0;
  const position = lineMs / windowMs - 0.5;
  if (position <= 0) return envelope[0]!;
  const index = Math.floor(position);
  if (index >= envelope.length - 1) return envelope[envelope.length - 1]!;
  const frac = position - index;
  return envelope[index]! * (1 - frac) + envelope[index + 1]! * frac;
}
