/** OpenAI TTS adapter (gpt-4o-mini-tts). The API key comes from the gateway
 *  (environment), never from the spec. Returns raw mp3; the gateway normalizes. */
import type { TtsAdapter } from "./types.ts";

export const openaiTts: TtsAdapter = async (req, cfg) => {
  if (!cfg.apiKey) {
    throw new Error(
      'OpenAI TTS needs OPENAI_API_KEY in the environment (it is never read from the spec). Set it, or use provider "say".',
    );
  }
  const base = cfg.baseUrl ?? "https://api.openai.com/v1";
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model ?? "gpt-4o-mini-tts",
      voice: req.voice ?? "alloy",
      input: req.text,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return { data: new Uint8Array(await res.arrayBuffer()), format: "mp3" };
};
