/** ffmpeg helpers. Bitexact flags + single-thread x264 for reproducible output. */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const COMMON = ["-map_metadata", "-1", "-fflags", "+bitexact"];

/** A still image + a narration wav → a fixed-duration mp4 clip. */
export function imageAudioToClip(o: {
  image: string;
  audio: string;
  durationSec: number;
  fps: number;
  outPath: string;
}): void {
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-loop", "1", "-i", o.image,
    "-i", o.audio,
    "-t", o.durationSec.toFixed(3),
    "-r", String(o.fps),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-threads", "1",
    "-flags:v", "+bitexact",
    "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
    "-flags:a", "+bitexact",
    "-movflags", "+faststart",
    ...COMMON,
    o.outPath,
  ]);
}

/** Concatenate same-codec clips (stream copy) into one mp4. */
export function concatClips(clips: string[], outPath: string, workDir: string): void {
  const list = join(workDir, "concat.txt");
  writeFileSync(
    list,
    clips.map((c) => `file '${resolve(c).replace(/'/g, "'\\''")}'`).join("\n") + "\n",
  );
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", list,
    "-c", "copy",
    "-movflags", "+faststart",
    ...COMMON,
    outPath,
  ]);
}
