/** Shared deterministic encode args. concatClips stream-copies clips from
 *  multiple producers, so every producer MUST use these exact settings. */
export const DETERMINISTIC_CONTAINER_ARGS = ["-map_metadata", "-1", "-fflags", "+bitexact"] as const;
export const DETERMINISTIC_VIDEO_ARGS = [
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-preset",
  "medium",
  "-threads",
  "1",
  "-flags:v",
  "+bitexact",
] as const;
export const DETERMINISTIC_AUDIO_ARGS = [
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "44100",
  "-ac",
  "2",
  "-flags:a",
  "+bitexact",
] as const;
export const FASTSTART_ARGS = ["-movflags", "+faststart"] as const;
