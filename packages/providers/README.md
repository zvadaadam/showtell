# @agent-video/providers

The narration gateway: synthesize a scene's narration text to a WAV, behind one
swappable async interface (`TtsAdapter`). The gateway owns config, normalization,
and caching; adapters just return raw audio.

- `synthesize(req, { provider, cacheDir })` — text + voice → WAV, content-hash cached per line.
- Providers: **`say`** (macOS, local, no key), **`openai`** (`OPENAI_API_KEY`),
  **`replicate`** (`REPLICATE_API_TOKEN` + `meta.tts.model`), and **`elevenlabs`**
  (`ELEVENLABS_API_KEY` + `meta.tts.voice` or `ELEVENLABS_VOICE_ID`). Keys are
  read from the environment, never the spec.
- `probeDurationMs(file)` — ffprobe duration (drives the two-pass `auto` scene lengths).

Internal package of [agent-video](../../README.md).
