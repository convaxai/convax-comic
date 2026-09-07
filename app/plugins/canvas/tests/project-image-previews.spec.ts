import { describe, expect, it, vi } from 'vitest'
import { ProjectImagePreviews, projectFileAssetId, projectImagePath } from '../src/client/project-image-previews.js'
import type { CanvasProjectFileContent } from '../src/client/comic-ui-contract.js'

const content = (path: string): CanvasProjectFileContent => ({
  kind: 'image', path, name: 'image.png', mimeType: 'image/png', size: 8, dataBase64: 'iVBORw0KGgo=',
})
const tick = async () => { for (let n = 0; n < 8; n++) await Promise.resolve() }

function setup(reader = vi.fn(async (path: string) => content(path))) {
  const objectUrl = { createObjectURL: vi.fn(() => 'blob:recovered'), revokeObjectURL: vi.fn() }
  const changed = vi.fn()
  const previews = new ProjectImagePreviews(reader, objectUrl, changed, 25 * 1024 * 1024, ['image/png'])
  return { previews, reader, objectUrl, changed }
}

describe('workspace image source recovery', () => {
  it('recognizes explicit project references and decodes exact legacy loopback paths', () => {
    const path = '示例项目/角色/人物/face.png'
    expect(projectImagePath({ type: 'asset', assetId: projectFileAssetId(path) })).toBe(path)
    expect(projectImagePath({ type: 'url', url: `http://127.0.0.1:61234/${encodeURI(path)}` })).toBe(path)
    expect(projectImagePath({ type: 'asset', assetId: 'asset:v2-1' })).toBeUndefined()
  })

  it.each([
    'https://example.test/art.png', 'file:///art.png', 'http://127.0.0.1:123/a/../art.png',
    'http://127.0.0.1:123/%2e%2e/art.png', 'http://127.0.0.1:123/%2Fart.png',
    'http://127.0.0.1:123/a%5Cb.png', 'http://user:pass@127.0.0.1:123/art.png',
    'http://127.0.0.1:123/art.png?token=x', 'http://127.0.0.1:123/art.png#x',
    'http://127.0.0.1:123/%00.png', 'http://127.0.0.1:123/%zz.png',
  ])('never infers an authoritative path from unsafe/unrelated URL %s', url => {
    expect(projectImagePath({ type: 'url', url })).toBeUndefined()
  })

  it('rejects unrepresentable paths rather than silently making imports temporary', () => {
    expect(() => projectFileAssetId('../art.png')).toThrow()
    expect(() => projectFileAssetId('/art.png')).toThrow()
    expect(() => projectFileAssetId('x'.repeat(513))).toThrow()
  })

  it('reads only scoped paths, deduplicates, publishes and revokes derived URLs', async () => {
    const { previews, reader, objectUrl, changed } = setup()
    previews.sync(new Map([['original-url', 'art.png']]))
    previews.sync(new Map([['original-url', 'art.png']]))
    await tick()
    expect(reader).toHaveBeenCalledExactlyOnceWith('art.png', expect.any(AbortSignal))
    expect(previews.get('original-url')).toBe('blob:recovered')
    expect(changed).toHaveBeenCalledOnce()
    previews.sync(new Map())
    expect(previews.get('original-url')).toBeUndefined()
    expect(objectUrl.revokeObjectURL).toHaveBeenCalledWith('blob:recovered')
    previews.dispose()
  })

  it('leaves missing or mismatched sources unavailable without retry loops', async () => {
    const reader = vi.fn(async (path: string) => {
      if (path === 'missing.png') throw new Error('not found')
      return content('different.png')
    })
    const { previews, objectUrl } = setup(reader)
    const sources = new Map([['missing', 'missing.png'], ['mismatch', 'art.png']])
    previews.sync(sources)
    await tick()
    previews.sync(sources)
    await tick()
    expect(reader).toHaveBeenCalledTimes(2)
    expect(objectUrl.createObjectURL).not.toHaveBeenCalled()
    previews.dispose()
  })

  it('bounds concurrency and discards pending work on source switch/disposal', async () => {
    const pending: Array<{ resolve: (value: CanvasProjectFileContent) => void; path: string; signal: AbortSignal }> = []
    const reader = vi.fn((path: string, signal: AbortSignal) => new Promise<CanvasProjectFileContent>(resolve => {
      pending.push({ path, signal, resolve })
    }))
    const objectUrl = { createObjectURL: vi.fn(() => 'blob:late'), revokeObjectURL: vi.fn() }
    const previews = new ProjectImagePreviews(reader, objectUrl, vi.fn(), 20, ['image/png'])
    previews.sync(new Map([['a', 'a.png'], ['b', 'b.png'], ['c', 'c.png']]))
    expect(reader).toHaveBeenCalledTimes(2)
    previews.dispose()
    for (const entry of pending) {
      expect(entry.signal.aborted).toBe(true)
      entry.resolve(content(entry.path))
    }
    await tick()
    expect(reader).toHaveBeenCalledTimes(2)
    expect(objectUrl.createObjectURL).not.toHaveBeenCalled()
  })
})
