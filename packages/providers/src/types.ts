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
