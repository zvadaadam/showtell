# @agent-video/providers

The narration gateway: synthesize a scene's narration text to a WAV, behind one
swappable async interface (`TtsAdapter`). The gateway owns config, normalization,
and caching; adapters just return raw audio.

- `synthesize(req, { provider, cacheDir })` — text + voice → WAV, content-hash cached per line.
- Providers: **`say`** (macOS, local, no key) and **`openai`** (gpt-4o-mini-tts; key from
  `OPENAI_API_KEY` in the env — never the spec). `replicate`/`elevenlabs` slot in behind
  the same `TtsAdapter`.
- `probeDurationMs(file)` — ffprobe duration (drives the two-pass `auto` scene lengths).

Internal package of [agent-video](../../README.md).
