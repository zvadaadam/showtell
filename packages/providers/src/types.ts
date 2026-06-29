export type TtsProvider = "say" | "replicate" | "openai" | "elevenlabs";

export interface SynthesizeRequest {
  text: string;
  voice?: string;
  model?: string;
}

export interface SynthesisResult {
  /** Path to the synthesized mono 44.1k wav. */
  wavPath: string;
  durationMs: number;
  /** True if served from the per-line cache. */
  cached: boolean;
}

/** Provider config — sourced from the ENVIRONMENT by the gateway, never the spec. */
export interface TtsProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Raw audio an adapter returns; the gateway normalizes it to a wav. */
export interface RawAudio {
  data: Uint8Array;
  /** An ffmpeg-decodable container/codec hint, e.g. "aiff" | "mp3" | "wav". */
  format: string;
}

/**
 * A TTS adapter: text + voice → raw audio bytes. Async (network providers are
 * the norm). Adapters do NOT normalize or cache — the gateway owns both, so a
 * provider returning mp3 can't poison the content-addressed wav cache, and the
 * normalize step is written once.
 */
export type TtsAdapter = (req: SynthesizeRequest, cfg: TtsProviderConfig) => Promise<RawAudio>;
