import { type ReactNode, forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import type { VideoManifest, ManifestScene } from '@agent-video/core'
import { cn } from '#/lib/utils'

// The bundle (manifest.json + mp4s + thumbnails) is served at this path — by Vite
// from public/ in dev, and by the agent's render-and-serve command in production.
const BUNDLE = '/bundle/'
const SPEEDS = [1, 1.5, 2] as const

const KIND_LABEL: Record<string, string> = {
  title: 'Title',
  code: 'Code',
  diff: 'Diff',
  'talking-points': 'Points',
  chart: 'Chart',
  screencap: 'Screen',
}

function fmtTime(sec: number): string {
  const s = Math.floor(Math.max(0, sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function refLabel(refs: NonNullable<ManifestScene['refs']>): string {
  const lines = refs.lineStart
    ? `:${refs.lineStart}${refs.lineEnd && refs.lineEnd !== refs.lineStart ? `-${refs.lineEnd}` : ''}`
    : ''
  return `${refs.file}${lines}${refs.ref ? ` @ ${refs.ref}` : ''}`
}

interface RailProps {
  scenes: VideoManifest['scenes']
  activeIndex: number
  onSeek: (scene: ManifestScene) => void
}

export function Player() {
  const [manifest, setManifest] = useState<VideoManifest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${BUNDLE}manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((m) => {
        if (alive) setManifest(m as VideoManifest)
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [])

  if (error)
    return (
      <Centered>
        <span className="text-red-400" data-testid="player-error">
          Failed to load bundle: {error}
        </span>
      </Centered>
    )
  if (!manifest)
    return (
      <Centered>
        <span className="text-neutral-500" data-testid="player-loading">
          Loading bundle…
        </span>
      </Centered>
    )
  return <PlayerView manifest={manifest} />
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-neutral-950 text-sm text-neutral-200" data-testid="player">
      {children}
    </div>
  )
}

function PlayerView({ manifest }: { manifest: VideoManifest }) {
  const ratios = manifest.outputs.map((o) => o.aspectRatio)
  const videoRef = useRef<HTMLVideoElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<{ time: number; play: boolean } | null>(null)

  const [aspect, setAspect] = useState<string>(ratios.includes('16:9') ? '16:9' : ratios[0]!)
  const [speed, setSpeed] = useState<number>(1)
  const [currentTime, setCurrentTime] = useState(0)

  const output = manifest.outputs.find((o) => o.aspectRatio === aspect) ?? manifest.outputs[0]!
  const src = `${BUNDLE}${output.file}`
  const scenes = manifest.scenes

  const activeIndex = useMemo(() => {
    let idx = 0
    for (let i = 0; i < scenes.length; i++) {
      if (currentTime + 0.04 >= scenes[i]!.startSec) idx = i
      else break
    }
    return idx
  }, [currentTime, scenes])

  // keep playbackRate applied across speed changes and source swaps
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, src])

  // active transcript line tracks playback
  useEffect(() => {
    transcriptRef.current
      ?.querySelector(`[data-scene="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIndex])

  function seekToScene(scene: ManifestScene) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = scene.startSec + 0.03
    void v.play().catch(() => {})
  }

  // swap aspect ratio without losing playback position
  function changeAspect(next: string) {
    if (next === aspect) return
    const v = videoRef.current
    restoreRef.current = { time: v?.currentTime ?? 0, play: v ? !v.paused : false }
    setAspect(next)
  }

  function onLoadedMetadata() {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = speed
    const r = restoreRef.current
    if (r) {
      v.currentTime = r.time
      if (r.play) void v.play().catch(() => {})
      restoreRef.current = null
    }
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200" data-testid="player">
      <header className="flex items-center gap-4 border-b border-neutral-800/80 px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-neutral-100" data-testid="title">
            {manifest.meta.title}
          </h1>
          <RepoChip manifest={manifest} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AspectToggle ratios={ratios} aspect={aspect} onChange={changeAspect} />
          <SpeedControl speed={speed} onChange={setSpeed} />
          <ShareButton />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1400px] gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <div
            className={cn(
              'mx-auto overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-neutral-800',
              aspect === '9:16' ? 'max-w-[min(420px,100%)]' : 'w-full',
            )}
          >
            <video
              ref={videoRef}
              data-testid="video"
              className={cn('block w-full', aspect === '9:16' ? 'aspect-[9/16]' : 'aspect-video')}
              src={src}
              controls
              playsInline
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={onLoadedMetadata}
            />
          </div>
          <ChapterStrip scenes={scenes} activeIndex={activeIndex} onSeek={seekToScene} />
        </section>

        <aside className="min-w-0">
          <Transcript ref={transcriptRef} scenes={scenes} activeIndex={activeIndex} onSeek={seekToScene} />
          <MetadataPanel manifest={manifest} />
        </aside>
      </main>
    </div>
  )
}

function RepoChip({ manifest }: { manifest: VideoManifest }) {
  const { repo } = manifest.meta
  return (
    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500" data-testid="meta-repo">
      <span className="font-mono">{repo.path}</span>
      {repo.commit && <span className="font-mono text-neutral-600">@ {repo.commit.slice(0, 7)}</span>}
      {repo.branch && (
        <span className="rounded bg-neutral-800/70 px-1.5 py-0.5 text-[11px] text-neutral-400">{repo.branch}</span>
      )}
    </div>
  )
}

function Segmented({ children }: { children: ReactNode }) {
  return <div className="flex rounded-lg border border-neutral-800 p-0.5">{children}</div>
}

function SegButton({ active, onClick, testid, children }: { active: boolean; onClick: () => void; testid: string; children: ReactNode }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition',
        active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-400 hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  )
}

function AspectToggle({ ratios, aspect, onChange }: { ratios: string[]; aspect: string; onChange: (r: string) => void }) {
  if (ratios.length < 2) return null
  return (
    <Segmented>
      {ratios.map((r) => (
        <SegButton key={r} testid={`aspect-${r}`} active={r === aspect} onClick={() => onChange(r)}>
          {r}
        </SegButton>
      ))}
    </Segmented>
  )
}

function SpeedControl({ speed, onChange }: { speed: number; onChange: (s: number) => void }) {
  return (
    <div data-testid="speed">
      <Segmented>
        {SPEEDS.map((s) => (
          <SegButton key={s} testid={`speed-${s}`} active={s === speed} onClick={() => onChange(s)}>
            {s}×
          </SegButton>
        ))}
      </Segmented>
    </div>
  )
}

function ShareButton() {
  const [state, setState] = useState<'idle' | 'sharing' | 'done'>('idle')
  async function onShare() {
    setState('sharing')
    // Stubbed hosted-share endpoint. Real hosting is a paid, server-side feature
    // wired later; the button proves the flow.
    await fetch('/api/share', { method: 'POST' }).catch(() => {})
    setState('done')
    window.setTimeout(() => setState('idle'), 2000)
  }
  return (
    <button
      data-testid="share"
      onClick={onShare}
      className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-white"
    >
      {state === 'done' ? 'Link ready (stub)' : state === 'sharing' ? 'Sharing…' : 'Share'}
    </button>
  )
}

function ChapterStrip({ scenes, activeIndex, onSeek }: RailProps) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">Chapters</div>
      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="chapters">
        {scenes.map((scene, i) => (
          <button key={i} data-testid={`chapter-${i}`} onClick={() => onSeek(scene)} className="group shrink-0 text-left">
            <div
              className={cn(
                'relative h-[72px] w-[128px] overflow-hidden rounded-lg ring-1 transition',
                i === activeIndex ? 'ring-2 ring-sky-400' : 'ring-neutral-800 group-hover:ring-neutral-600',
              )}
            >
              {scene.thumbnail ? (
                <img src={`${BUNDLE}${scene.thumbnail}`} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center bg-neutral-900 text-[11px] text-neutral-500">
                  {KIND_LABEL[scene.kind] ?? scene.kind}
                </div>
              )}
              <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-neutral-200">
                {fmtTime(scene.startSec)}
              </span>
            </div>
            <div className={cn('mt-1.5 w-[128px] truncate text-xs', i === activeIndex ? 'text-neutral-100' : 'text-neutral-400')}>
              {KIND_LABEL[scene.kind] ?? scene.kind}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const Transcript = forwardRef<HTMLDivElement, RailProps>(function Transcript({ scenes, activeIndex, onSeek }, ref) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
      <div className="border-b border-neutral-800 px-4 py-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
        Transcript
      </div>
      <div ref={ref} className="max-h-[58vh] overflow-y-auto p-2" data-testid="transcript">
        {scenes.map((scene, i) => {
          const active = i === activeIndex
          return (
            <button
              key={i}
              data-scene={i}
              data-testid={`transcript-${i}`}
              data-active={active}
              onClick={() => onSeek(scene)}
              className={cn(
                'block w-full rounded-lg px-3 py-2.5 text-left transition',
                active ? 'bg-neutral-800/80' : 'hover:bg-neutral-800/40',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-neutral-500">{fmtTime(scene.startSec)}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium',
                    active ? 'bg-sky-500/20 text-sky-300' : 'bg-neutral-800 text-neutral-400',
                  )}
                >
                  {KIND_LABEL[scene.kind] ?? scene.kind}
                </span>
              </div>
              <p className={cn('mt-1.5 text-sm leading-relaxed', active ? 'text-neutral-100' : 'text-neutral-400')}>
                {scene.narration}
              </p>
              {scene.refs && (
                <span
                  data-testid={`ref-${i}`}
                  className="mt-1.5 inline-block rounded bg-neutral-800/80 px-2 py-0.5 font-mono text-[11px] text-sky-300/90"
                >
                  {refLabel(scene.refs)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
})

function MetadataPanel({ manifest }: { manifest: VideoManifest }) {
  const { repo } = manifest.meta
  return (
    <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs" data-testid="metadata">
      <div className="mb-2.5 font-medium uppercase tracking-wide text-neutral-500">Details</div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-neutral-500">Repo</dt>
        <dd className="truncate font-mono text-neutral-300">{repo.path}</dd>
        {repo.commit && (
          <>
            <dt className="text-neutral-500">Commit</dt>
            <dd className="font-mono text-neutral-300">{repo.commit.slice(0, 12)}</dd>
          </>
        )}
        {repo.branch && (
          <>
            <dt className="text-neutral-500">Branch</dt>
            <dd className="truncate font-mono text-neutral-300">{repo.branch}</dd>
          </>
        )}
        <dt className="text-neutral-500">Length</dt>
        <dd className="tabular-nums text-neutral-300">{fmtTime(manifest.durationSec)}</dd>
        <dt className="text-neutral-500">Scenes</dt>
        <dd className="text-neutral-300">{manifest.scenes.length}</dd>
      </dl>
    </div>
  )
}
