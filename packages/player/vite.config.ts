import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Minimal canonical TanStack Start config. The scaffold's explicit `nitro()` and
// `devtools()` plugins are dropped: the `nitro/vite` import resolved through the
// `npm:nitro-nightly` alias isn't exposed as a top-level `nitro` package under
// Bun's layout, which broke `vite dev`. `tanstackStart()` carries its own nitro
// as a transitive dep, so the server still builds.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  // SPA mode: prerender a static index.html shell so the built player is a pure
  // client app the agent's Bun serve command can host (no Node/nitro runtime).
  plugins: [tailwindcss(), tanstackStart({ spa: { enabled: true } }), viteReact()],
})
