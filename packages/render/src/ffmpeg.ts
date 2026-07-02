/** ffmpeg helpers. Bitexact flags + single-thread x264 for reproducible output. */
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DETERMINISTIC_AUDIO_ARGS,
  DETERMINISTIC_CONTAINER_ARGS,
  DETERMINISTIC_VIDEO_ARGS,
  FASTSTART_ARGS,
} from "@agent-video/capture";

/** A still image + a narration wav → a fixed-duration mp4 clip. */
export function imageAudioToClip(o: {
  image: string;
  audio: string;
  durationSec: number;
  fps: number;
  outPath: string;
}): void {
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-i",
    o.image,
    "-i",
    o.audio,
    "-t",
    o.durationSec.toFixed(3),
    "-r",
    String(o.fps),
    ...DETERMINISTIC_VIDEO_ARGS,
    ...DETERMINISTIC_AUDIO_ARGS,
    ...FASTSTART_ARGS,
    ...DETERMINISTIC_CONTAINER_ARGS,
    o.outPath,
  ]);
}

/** Concatenate same-codec clips (stream copy) into one mp4. */
export function concatClips(clips: string[], outPath: string, workDir: string): void {
  const list = join(workDir, "concat.txt");
  writeFileSync(list, clips.map((c) => `file '${resolve(c).replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-c",
    "copy",
    ...FASTSTART_ARGS,
    ...DETERMINISTIC_CONTAINER_ARGS,
    outPath,
  ]);
}

export interface MusicMixTrack {
  file: string;
  startSec: number;
  durationSec: number;
  gainDb: number;
  loop: boolean;
  duckUnderNarration: boolean;
  fadeInSec: number;
  fadeOutSec: number;
}

/** Mix deterministic background music beds under an already-rendered video. */
export function mixMusicTracks(videoPath: string, tracks: MusicMixTrack[], outPath: string, workDir: string): void {
  if (tracks.length === 0) {
    copyFileSync(videoPath, outPath);
    return;
  }

  const prepared = tracks.map((track, i) => {
    const out = join(workDir, `music-${String(i).padStart(2, "0")}.wav`);
    const inputArgs = track.loop ? ["-stream_loop", "-1", "-i", track.file] : ["-i", track.file];
    const duration = Math.max(0.001, track.durationSec);
    const filters = [`atrim=0:${duration.toFixed(3)}`, "asetpts=PTS-STARTPTS", `volume=${track.gainDb}dB`];
    if (track.fadeInSec > 0) filters.push(`afade=t=in:st=0:d=${track.fadeInSec.toFixed(3)}`);
    if (track.fadeOutSec > 0 && track.fadeOutSec < duration) {
      filters.push(
        `afade=t=out:st=${Math.max(0, duration - track.fadeOutSec).toFixed(3)}:d=${track.fadeOutSec.toFixed(3)}`,
      );
    }
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      ...inputArgs,
      "-t",
      duration.toFixed(3),
      "-filter:a",
      filters.join(","),
      "-ar",
      "44100",
      "-ac",
      "2",
      ...DETERMINISTIC_CONTAINER_ARGS,
      out,
    ]);
    return out;
  });

  const inputs = prepared.flatMap((input) => ["-i", input]);
  const delayed = tracks.map(
    (track, i) => `[${i + 1}:a]adelay=${Math.max(0, Math.round(track.startSec * 1000))}:all=1[m${i}]`,
  );
  const ducked = tracks.map((track, i) =>
    track.duckUnderNarration
      ? `[m${i}][0:a]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=250[mm${i}]`
      : `[m${i}]anull[mm${i}]`,
  );
  const mixInputs = ["[0:a]", ...tracks.map((_, i) => `[mm${i}]`)].join("");
  const filter = [
    ...delayed,
    ...ducked,
    `${mixInputs}amix=inputs=${tracks.length + 1}:duration=first:dropout_transition=0:normalize=0[a]`,
  ].join(";");

  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "0:v:0",
    "-map",
    "[a]",
    "-c:v",
    "copy",
    ...DETERMINISTIC_AUDIO_ARGS,
    ...FASTSTART_ARGS,
    ...DETERMINISTIC_CONTAINER_ARGS,
    outPath,
  ]);
}

/** Final guardrail: pad/trim both streams to the compiled timeline duration. */
export function normalizeVideoDuration(videoPath: string, outPath: string, durationSec: number, fps: number): void {
  const frameCount = Math.max(1, Math.round(durationSec * fps));
  const duration = (frameCount / fps).toFixed(6);
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    videoPath,
    "-filter_complex",
    `[0:v]tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},setpts=PTS-STARTPTS,fps=${fps}[v];[0:a]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    ...DETERMINISTIC_VIDEO_ARGS,
    ...DETERMINISTIC_AUDIO_ARGS,
    ...FASTSTART_ARGS,
    ...DETERMINISTIC_CONTAINER_ARGS,
    outPath,
  ]);
}

/** Generate a deterministic silent wav, used for scene tails after narration. */
export function silentAudio(outPath: string, durationSec: number): void {
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    durationSec.toFixed(3),
    "-c:a",
    "pcm_s16le",
    ...DETERMINISTIC_CONTAINER_ARGS,
    outPath,
  ]);
}
