/**
 * TTS gateway — one interface (text+voice → wav), swappable provider adapters,
 * cached per narration line (content-addressed). Adapters return raw audio; the
 * gateway owns config (from the ENV, never the spec), normalization to a
 * deterministic mono 44.1k wav, and the cache — so every adapter benefits and a
 * remote provider returning mp3 can't poison the cache.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sayTts } from "./say.ts";
import { openaiTts } from "./openai.ts";
import { replicateTts } from "./replicate.ts";
import { elevenLabsTts } from "./elevenlabs.ts";
import { probeDurationMs } from "./ffprobe.ts";
import type {
  SynthesizeRequest,
  SynthesisResult,
  TtsProvider,
  TtsAdapter,
  TtsProviderConfig,
  RawAudio,
} from "./types.ts";

export type {
  SynthesizeRequest,
  SynthesisResult,
  TtsProvider,
  TtsProviderConfig,
  RawAudio,
  TtsAdapter,
} from "./types.ts";
export { probeDurationMs, probeVideoSize } from "./ffprobe.ts";

const ADAPTERS: Partial<Record<TtsProvider, TtsAdapter>> = {
  say: sayTts,
  openai: openaiTts,
  replicate: replicateTts,
  elevenlabs: elevenLabsTts,
};

export interface SynthesizeOpts {
  provider?: TtsProvider;
  cacheDir?: string;
}

/** Per-provider config from the ENVIRONMENT (never the spec). */
function configFromEnv(provider: TtsProvider): TtsProviderConfig {
  if (provider === "openai") {
    return { apiKey: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL, timeoutMs: 30_000 };
  }
  if (provider === "replicate") {
    return {
      apiKey: process.env.REPLICATE_API_TOKEN,
      baseUrl: process.env.REPLICATE_API_BASE_URL,
      timeoutMs: 60_000,
    };
  }
  if (provider === "elevenlabs") {
    return {
      apiKey: process.env.ELEVENLABS_API_KEY ?? process.env.ELEVEN_LABS_API_KEY,
      baseUrl: process.env.ELEVENLABS_BASE_URL,
      timeoutMs: 30_000,
    };
  }
  return {};
}

/** Normalize any provider audio to a deterministic mono 44.1k PCM wav. */
function normalizeToWav(raw: RawAudio, wavPath: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "av-tts-norm-"));
  const tmpWavPath = `${wavPath}.tmp.wav`;
  try {
    rmSync(tmpWavPath, { force: true });
    const inPath = join(tmp, `in.${raw.format}`);
    writeFileSync(inPath, raw.data);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", inPath, "-ar", "44100", "-ac", "1", tmpWavPath]);
    renameSync(tmpWavPath, wavPath);
  } catch (e) {
    rmSync(tmpWavPath, { force: true });
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function cacheKey(provider: TtsProvider, req: SynthesizeRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ provider, voice: req.voice ?? "", model: req.model ?? "", text: req.text }))
    .digest("hex")
    .slice(0, 32);
}

/** Synthesize narration to a wav, using the per-line cache when possible. */
export async function synthesize(req: SynthesizeRequest, opts: SynthesizeOpts = {}): Promise<SynthesisResult> {
  const provider = opts.provider ?? "say";
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `TTS provider "${provider}" is not available yet. Available: ${availableTtsProviders().join(", ")}.`,
    );
  }
  const cacheDir = opts.cacheDir ?? ".agent-video/cache/tts";
  mkdirSync(cacheDir, { recursive: true });
  const wavPath = join(cacheDir, `${provider}-${cacheKey(provider, req)}.wav`);

  if (existsSync(wavPath)) {
    try {
      return { wavPath, durationMs: probeDurationMs(wavPath), cached: true };
    } catch {
      rmSync(wavPath, { force: true });
    }
  }
  const raw = await adapter(req, configFromEnv(provider));
  normalizeToWav(raw, wavPath);
  return { wavPath, durationMs: probeDurationMs(wavPath), cached: false };
}

/** Provider names that have an adapter wired (an API provider still needs its key). */
export function availableTtsProviders(): TtsProvider[] {
  return Object.keys(ADAPTERS) as TtsProvider[];
}
