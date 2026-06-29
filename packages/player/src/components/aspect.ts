export function playerAspectClasses(aspect: string): { frame: string; video: string } {
  if (aspect === '9:16') return { frame: 'max-w-[min(420px,100%)]', video: 'aspect-[9/16]' }
  if (aspect === '1:1') return { frame: 'max-w-[min(720px,100%)]', video: 'aspect-square' }
  return { frame: 'w-full', video: 'aspect-video' }
}
