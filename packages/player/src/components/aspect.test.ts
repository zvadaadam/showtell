import { test, expect } from 'bun:test'
import { playerAspectClasses } from './aspect'

test('player aspect classes include a real square mode', () => {
  expect(playerAspectClasses('16:9').video).toBe('aspect-video')
  expect(playerAspectClasses('9:16').video).toBe('aspect-[9/16]')
  expect(playerAspectClasses('1:1')).toEqual({
    frame: 'max-w-[min(720px,100%)]',
    video: 'aspect-square',
  })
})
