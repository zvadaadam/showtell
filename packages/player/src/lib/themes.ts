/**
 * Theme registry — the open-core seam. The free build registers one clean
 * default theme; a private `@agent-video/player-pro` can `registerTheme(...)`
 * additional premium themes at startup without forking the player. The player
 * reads the registry and applies the active theme's CSS custom properties to its
 * root, and the theme switcher only appears once more than one theme is present.
 *
 * A theme is the full surface palette as CSS variables — premium themes (and
 * premium components that read these vars) slot in through this same surface.
 */
export interface Theme {
  id: string
  label: string
  /** Premium themes set this; the free tier ships only non-pro themes. */
  pro?: boolean
  /** CSS custom properties applied to the player root. */
  vars: Record<string, string>
}

const registry = new Map<string, Theme>()

export function registerTheme(theme: Theme): void {
  registry.set(theme.id, theme)
}

export function getTheme(id: string): Theme | undefined {
  return registry.get(id)
}

export function listThemes(): Theme[] {
  return [...registry.values()]
}

export const DEFAULT_THEME_ID = 'console'

// The free baseline — "Console": a cool indigo-black editor at night, warm paper
// text (the human narration), cool muted chrome (the machine), and a single
// amber accent that reads as a render/film playhead.
registerTheme({
  id: 'console',
  label: 'Console',
  vars: {
    '--av-ink': '#0b0d13',
    '--av-raised': '#12151c',
    '--av-line': 'rgba(146, 154, 184, 0.14)',
    '--av-paper': '#e9e7e0',
    '--av-mute': '#878fa6',
    '--av-accent': '#f5a524',
    '--av-accent-soft': 'rgba(245, 165, 36, 0.13)',
  },
})
