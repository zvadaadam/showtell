# @agent-video/providers

The narration gateway: synthesize a scene's narration text to a WAV, behind one
swappable interface (local `say` today; BYO-API adapters to come).

- `synthesize(req, wavPath)` — text + voice → WAV, content-hash cached per line.
- `probeDurationMs(file)` — ffprobe duration (drives the two-pass `auto` scene lengths).

Internal package of [agent-video](../../README.md).
