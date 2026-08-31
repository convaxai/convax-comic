import { describe, expect, it } from 'vitest'
import { promptNodeTitle } from '../src/client/CanvasView.tsx'

describe('Canvas Convax visual helpers', () => {
  it('creates compact Unicode-safe titles for animated prompt nodes', () => {
    expect(promptNodeTitle('  雨夜   便利店的重逢  ')).toBe('雨夜 便利店的重逢')
    expect(promptNodeTitle('🎬'.repeat(40))).toBe(`${'🎬'.repeat(32)}…`)
  })
})
