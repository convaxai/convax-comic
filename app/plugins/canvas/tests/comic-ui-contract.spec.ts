import { describe, expect, it } from 'vitest'
import {
  CANVAS_DROP_MIME,
  parseCanvasDropPayload,
} from '../src/client/comic-ui-contract.ts'

describe('Comic Canvas UI-only drop contract', () => {
  it('accepts strict note/image V2 payloads without defining a persisted schema', () => {
    expect(CANVAS_DROP_MIME).toBe('application/vnd.convax.canvas-node.v2+json')
    expect(parseCanvasDropPayload(JSON.stringify({ kind: 'note', title: 'Beat', text: 'Line' })))
      .toEqual({ kind: 'note', title: 'Beat', text: 'Line' })
    expect(parseCanvasDropPayload({
      kind: 'image',
      title: 'Panel',
      source: { type: 'url', url: 'https://example.com/panel.png' },
      alt: 'Panel',
    })).toMatchObject({ kind: 'image', source: { url: 'https://example.com/panel.png' } })
  })

  it('rejects video, credentials, unknown fields, and oversized JSON', () => {
    expect(() => parseCanvasDropPayload({ kind: 'video', title: 'Legacy', source: { type: 'url', url: 'https://example.com/v.mp4' } })).toThrow()
    expect(() => parseCanvasDropPayload({
      kind: 'image', title: 'Bad', source: { type: 'url', url: 'https://user:secret@example.com/a.png' }, alt: '',
    })).toThrow()
    expect(() => parseCanvasDropPayload({ kind: 'note', title: '', text: '', extra: true })).toThrow()
    expect(() => parseCanvasDropPayload('x'.repeat(64 * 1024 + 1))).toThrow(/too large/u)
  })
})
