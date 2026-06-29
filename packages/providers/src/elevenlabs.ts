/** ElevenLabs TTS adapter. API key + optional voice id come from the environment;
 *  the spec only names provider/model/voice. */
import type { TtsAdapter } from "./types.ts";

export const elevenLabsTts: TtsAdapter = async (req, cfg) => {
  if (!cfg.apiKey) {
    throw new Error(
      'ElevenLabs TTS needs ELEVENLABS_API_KEY in the environment (it is never read from the spec). Set it, or use provider "say".',
    );
  }
  const voiceId = req.voice ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error("ElevenLabs TTS needs req.voice or ELEVENLABS_VOICE_ID to select a voice.");
  }
  const base = cfg.baseUrl ?? "https://api.elevenlabs.io";
  const res = await fetch(`${base}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": cfg.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: req.text,
      model_id: req.model ?? "eleven_multilingual_v2",
      seed: 0,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return { data: new Uint8Array(await res.arrayBuffer()), format: "mp3" };
};
