/** Replicate TTS adapter. Uses the generic predictions API so users can bring
 *  any text-to-speech model/version that returns an audio URL. */
import type { TtsAdapter } from "./types.ts";

interface Prediction {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
  urls?: { get?: string };
}

function audioUrl(output: unknown): string | undefined {
  if (typeof output === "string" && /^https?:\/\//.test(output)) return output;
  if (Array.isArray(output)) return output.map(audioUrl).find(Boolean);
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const key of ["audio", "url", "output", "file"]) {
      const u = audioUrl(o[key]);
      if (u) return u;
    }
  }
  return undefined;
}

async function parsePrediction(res: Response, label: string): Promise<Prediction> {
  const body = await res.text();
  if (!res.ok) throw new Error(`${label} failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body) as Prediction;
}

async function waitForPrediction(first: Prediction, cfg: { apiKey: string; timeoutMs: number }): Promise<Prediction> {
  let p = first;
  const attempts = Math.max(1, Math.ceil(cfg.timeoutMs / 1000));
  for (
    let i = 0;
    p.status && !["succeeded", "failed", "canceled"].includes(p.status) && p.urls?.get && i < attempts;
    i++
  ) {
    await Bun.sleep(1000);
    const res = await fetch(p.urls.get, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(Math.min(5000, cfg.timeoutMs)),
    });
    p = await parsePrediction(res, "Replicate prediction poll");
  }
  return p;
}

export const replicateTts: TtsAdapter = async (req, cfg) => {
  if (!cfg.apiKey) {
    throw new Error(
      'Replicate TTS needs REPLICATE_API_TOKEN in the environment (it is never read from the spec). Set it, or use provider "say".',
    );
  }
  if (!req.model) {
    throw new Error('Replicate TTS needs a model/version in spec.meta.tts.model, for example "owner/model:version".');
  }
  const timeoutMs = cfg.timeoutMs ?? 60_000;
  const base = cfg.baseUrl ?? "https://api.replicate.com/v1";
  const res = await fetch(`${base}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      version: req.model,
      input: { text: req.text, voice: req.voice },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const prediction = await waitForPrediction(await parsePrediction(res, "Replicate TTS request"), {
    apiKey: cfg.apiKey,
    timeoutMs,
  });
  if (prediction.status === "failed" || prediction.status === "canceled") {
    throw new Error(`Replicate TTS prediction ${prediction.status}: ${String(prediction.error ?? "")}`);
  }
  const url = audioUrl(prediction.output);
  if (!url) throw new Error("Replicate TTS prediction completed without an audio URL output.");
  const audio = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!audio.ok) throw new Error(`Replicate audio download failed (${audio.status}).`);
  return { data: new Uint8Array(await audio.arrayBuffer()), format: "mp3" };
};
