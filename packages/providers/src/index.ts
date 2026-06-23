/**
 * TTS gateway — one interface (text+voice → wav), swappable provider adapters,
 * cached per narration line (content-addressed). BYO-API adapters (Replicate/
 * OpenAI/ElevenLabs) plug in here later behind the same `synthesize`.
 */
import { existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sayToWav } from "./say.ts";
import { probeDurationMs } from "./ffprobe.ts";
import type { SynthesizeRequest, SynthesisResult, TtsProvider } from "./types.ts";

export type { SynthesizeRequest, SynthesisResult, TtsProvider } from "./types.ts";
export { probeDurationMs } from "./ffprobe.ts";

type Adapter = (req: SynthesizeRequest, wavPath: string) => void | Promise<void>;

const ADAPTERS: Partial<Record<TtsProvider, Adapter>> = {
  say: sayToWav,
  // replicate / openai / elevenlabs: added later (BYO-API), same signature.
};

export interface SynthesizeOpts {
  provider?: TtsProvider;
  cacheDir?: string;
}

/** Synthesize narration to a wav, using the per-line cache when possible. */
export async function synthesize(req: SynthesizeRequest, opts: SynthesizeOpts = {}): Promise<SynthesisResult> {
  const provider = opts.provider ?? "say";
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(`TTS provider "${provider}" is not available yet. Available: ${Object.keys(ADAPTERS).join(", ")}.`);
  }
  const cacheDir = opts.cacheDir ?? ".agent-video/cache/tts";
  mkdirSync(cacheDir, { recursive: true });

  const key = createHash("sha256")
    .update(JSON.stringify({ provider, voice: req.voice ?? "", model: req.model ?? "", text: req.text }))
    .digest("hex")
    .slice(0, 32);
  const wavPath = join(cacheDir, `${provider}-${key}.wav`);

  if (existsSync(wavPath)) {
    return { wavPath, durationMs: probeDurationMs(wavPath), cached: true };
  }
  await adapter(req, wavPath);
  return { wavPath, durationMs: probeDurationMs(wavPath), cached: false };
}

/** Provider names that are currently usable. */
export function availableTtsProviders(): TtsProvider[] {
  return Object.keys(ADAPTERS) as TtsProvider[];
}
