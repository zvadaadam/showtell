import { type CSSProperties, type ReactNode, forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import type { VideoManifest, ManifestScene } from '@agent-video/core'
import { cn } from '#/lib/utils'
import { DEFAULT_THEME_ID, getTheme, listThemes } from '#/lib/themes'
import { playerAspectClasses } from './aspect'

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

// Mono machine-chrome label (timestamps, tags, eyebrows speak the "code" voice).
function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--av-mute)]', className)}>
      {children}
    </span>
  )
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
        <span className="font-mono text-sm text-red-400" data-testid="player-error">
          couldn’t load bundle — {error}
        </span>
      </Centered>
    )
  if (!manifest)
    return (
      <Centered>
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--av-mute)]" data-testid="player-loading">
          loading bundle…
        </span>
      </Centered>
    )
  return <PlayerView manifest={manifest} />
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--av-ink)]" data-testid="player">
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
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)
  const theme = getTheme(themeId) ?? listThemes()[0]!

  const output = manifest.outputs.find((o) => o.aspectRatio === aspect) ?? manifest.outputs[0]!
  const src = `${BUNDLE}${output.file}`
  const scenes = manifest.scenes
  const aspectClasses = playerAspectClasses(aspect)

  const activeIndex = useMemo(() => {
    let idx = 0
    for (let i = 0; i < scenes.length; i++) {
      if (currentTime + 0.04 >= scenes[i]!.startSec) idx = i
      else break
    }
    return idx
  }, [currentTime, scenes])

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, src])

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
    <div
      className="min-h-screen bg-[var(--av-ink)] text-[var(--av-paper)]"
      style={theme.vars as CSSProperties}
      data-testid="player"
    >
      <header className="av-rise flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[var(--av-line)] px-6 py-4">
        <div className="min-w-0">
          <Eyebrow className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--av-accent)]" />
            watch · agent-video
          </Eyebrow>
          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight text-[var(--av-paper)]" data-testid="title">
            {manifest.meta.title}
          </h1>
        </div>
        <RepoChip manifest={manifest} />
        <div className="ml-auto flex items-center gap-2">
          <AspectToggle ratios={ratios} aspect={aspect} onChange={changeAspect} />
          <SpeedControl speed={speed} onChange={setSpeed} />
          <ThemeSwitcher themeId={themeId} onChange={setThemeId} />
          <ShareButton />
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-7 p-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="av-rise min-w-0" style={{ animationDelay: '60ms' }}>
          <div
            className={cn(
              'mx-auto overflow-hidden rounded-2xl bg-black ring-1 ring-[var(--av-line)] shadow-[0_36px_90px_-32px_rgba(0,0,0,0.85)]',
              aspectClasses.frame,
            )}
          >
            <video
              ref={videoRef}
              data-testid="video"
              className={cn('block w-full', aspectClasses.video)}
              src={src}
              controls
              playsInline
              onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
              onLoadedMetadata={onLoadedMetadata}
            />
          </div>
          <ChapterStrip scenes={scenes} activeIndex={activeIndex} onSeek={seekToScene} />
        </section>

        <aside className="av-rise min-w-0" style={{ animationDelay: '120ms' }}>
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
    <div
      className="flex items-center gap-2 rounded-md border border-[var(--av-line)] bg-[var(--av-raised)] px-2.5 py-1 font-mono text-[11px] text-[var(--av-mute)]"
      data-testid="meta-repo"
    >
      <span className="text-[var(--av-paper)]">{repo.path}</span>
      {repo.commit && <span>@ {repo.commit.slice(0, 7)}</span>}
      {repo.branch && (
        <span className="border-l border-[var(--av-line)] pl-2 text-[var(--av-accent)]">{repo.branch}</span>
      )}
    </div>
  )
}

function Segmented({ children }: { children: ReactNode }) {
  return (
    <div className="flex rounded-lg border border-[var(--av-line)] bg-[var(--av-raised)] p-0.5">{children}</div>
  )
}

function SegButton({
  active,
  onClick,
  testid,
  children,
}: {
  active: boolean
  onClick: () => void
  testid: string
  children: ReactNode
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 font-mono text-xs transition-colors',
        active ? 'bg-[var(--av-paper)] text-[var(--av-ink)]' : 'text-[var(--av-mute)] hover:text-[var(--av-paper)]',
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

// Only renders once a pro pack has registered more than the default theme.
function ThemeSwitcher({ themeId, onChange }: { themeId: string; onChange: (id: string) => void }) {
  const themes = listThemes()
  if (themes.length < 2) return null
  return (
    <div data-testid="theme">
      <Segmented>
        {themes.map((t) => (
          <SegButton key={t.id} testid={`theme-${t.id}`} active={t.id === themeId} onClick={() => onChange(t.id)}>
            {t.label}
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
      className="rounded-lg bg-[var(--av-paper)] px-3.5 py-1.5 text-xs font-semibold text-[var(--av-ink)] transition hover:brightness-95"
    >
      {state === 'done' ? 'Link ready (stub)' : state === 'sharing' ? 'Sharing…' : 'Share'}
    </button>
  )
}

function ChapterStrip({ scenes, activeIndex, onSeek }: RailProps) {
  return (
    <div className="mt-5">
      <Eyebrow className="mb-2.5 block">Chapters</Eyebrow>
      <div className="flex gap-3 overflow-x-auto pb-1" data-testid="chapters">
        {scenes.map((scene, i) => {
          const active = i === activeIndex
          return (
            <button key={i} data-testid={`chapter-${i}`} onClick={() => onSeek(scene)} className="group shrink-0 text-left">
              <div
                className={cn(
                  'relative h-[74px] w-[132px] overflow-hidden rounded-lg ring-1 transition',
                  active ? 'ring-2 ring-[var(--av-accent)]' : 'ring-[var(--av-line)] group-hover:ring-[var(--av-mute)]',
                )}
              >
                {scene.thumbnail ? (
                  <img src={`${BUNDLE}${scene.thumbnail}`} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-[var(--av-raised)]">
                    <Eyebrow>{KIND_LABEL[scene.kind] ?? scene.kind}</Eyebrow>
                  </div>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 font-mono text-[10px] tabular-nums text-[var(--av-paper)]">
                  {fmtTime(scene.startSec)}
                </span>
              </div>
              <div
                className={cn(
                  'mt-1.5 w-[132px] truncate font-mono text-[11px]',
                  active ? 'text-[var(--av-accent)]' : 'text-[var(--av-mute)]',
                )}
              >
                {KIND_LABEL[scene.kind] ?? scene.kind}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const Transcript = forwardRef<HTMLDivElement, RailProps>(function Transcript({ scenes, activeIndex, onSeek }, ref) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--av-line)] bg-[var(--av-raised)]">
      <div className="flex items-center justify-between border-b border-[var(--av-line)] px-4 py-3">
        <Eyebrow>Transcript</Eyebrow>
        <Eyebrow>
          {String(Math.min(activeIndex + 1, scenes.length)).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
        </Eyebrow>
      </div>
      <div ref={ref} className="max-h-[56vh] overflow-y-auto py-1">
        {scenes.map((scene, i) => {
          const active = i === activeIndex
          const seen = i <= activeIndex
          return (
            <button
              key={i}
              data-scene={i}
              data-testid={`transcript-${i}`}
              data-active={active}
              onClick={() => onSeek(scene)}
              className={cn(
                'relative block w-full py-3 pl-9 pr-4 text-left transition-colors',
                active ? 'bg-[var(--av-accent-soft)]' : 'hover:bg-white/[0.025]',
              )}
            >
              {/* timeline spine + playhead node — the signature */}
              <span className="pointer-events-none absolute bottom-0 left-[15px] top-0 w-px bg-[var(--av-line)]" />
              <span
                className={cn(
                  'pointer-events-none absolute left-[11px] top-[15px] h-2.5 w-2.5 rounded-full transition',
                  active
                    ? 'bg-[var(--av-accent)] shadow-[0_0_0_4px_var(--av-accent-soft)]'
                    : seen
                      ? 'bg-[var(--av-accent)]/55'
                      : 'border border-[var(--av-line)] bg-[var(--av-raised)]',
                )}
              />
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'font-mono text-[11px] tabular-nums',
                    active ? 'text-[var(--av-accent)]' : 'text-[var(--av-mute)]',
                  )}
                >
                  {fmtTime(scene.startSec)}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                    active ? 'bg-[var(--av-accent)] text-[var(--av-ink)]' : 'bg-black/25 text-[var(--av-mute)]',
                  )}
                >
                  {KIND_LABEL[scene.kind] ?? scene.kind}
                </span>
              </div>
              <p className={cn('mt-1.5 text-[15px] leading-relaxed', active ? 'text-[var(--av-paper)]' : 'text-[var(--av-mute)]')}>
                {scene.narration}
              </p>
              {scene.refs && (
                <span
                  data-testid={`ref-${i}`}
                  className="mt-2 inline-flex items-center rounded border border-[var(--av-line)] bg-black/25 px-2 py-0.5 font-mono text-[11px] text-[var(--av-accent)]"
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
  const rows: [string, string][] = [['repo', repo.path]]
  if (repo.commit) rows.push(['commit', repo.commit.slice(0, 12)])
  if (repo.branch) rows.push(['branch', repo.branch])
  rows.push(['length', fmtTime(manifest.durationSec)], ['scenes', String(manifest.scenes.length)])

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--av-line)] bg-[var(--av-raised)]" data-testid="metadata">
      <div className="flex items-center justify-between border-b border-[var(--av-line)] px-4 py-3">
        <Eyebrow>Receipts</Eyebrow>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--av-accent)]">live bytes</span>
      </div>
      <dl className="px-4 py-3 font-mono text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3 py-1">
            <dt className="w-16 shrink-0 uppercase tracking-wider text-[var(--av-mute)]">{k}</dt>
            <dd className="truncate text-[var(--av-paper)]">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
