import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold" data-testid="player-heading">
        agent-video player
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">The watch surface. Bundle loading lands next.</p>
    </div>
  )
}
