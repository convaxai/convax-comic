import { describe, expect, it } from 'vitest'
import {
  COMIC_BUILTIN_KIND_VERSION,
  COMIC_IMAGE_NODE_TYPE,
  COMIC_NOTE_NODE_TYPE,
  COMIC_SEQUENCE_EDGE_TYPE,
  comicImageNodeType,
  comicNoteNodeType,
  comicSequenceEdgeType,
} from '../src/index.ts'

describe('comic builtin data contracts', () => {
  it('publishes exact versioned kind identities and fresh valid defaults', () => {
    expect(comicNoteNodeType).toMatchObject({ type: COMIC_NOTE_NODE_TYPE, kindVersion: COMIC_BUILTIN_KIND_VERSION })
    expect(comicImageNodeType).toMatchObject({ type: COMIC_IMAGE_NODE_TYPE, kindVersion: COMIC_BUILTIN_KIND_VERSION })
    expect(comicSequenceEdgeType).toMatchObject({ type: COMIC_SEQUENCE_EDGE_TYPE, kindVersion: COMIC_BUILTIN_KIND_VERSION })

    const first = comicNoteNodeType.createData()
    const second = comicNoteNodeType.createData()
    expect(first).toEqual({ title: '', text: '' })
    expect(first).not.toBe(second)
    expect(comicNoteNodeType.validateData(first)).toBe(true)
    expect(comicImageNodeType.validateData(comicImageNodeType.createData())).toBe(true)
    expect(comicSequenceEdgeType.validateData(comicSequenceEdgeType.createData())).toBe(true)
    expect(Object.isFrozen(comicNoteNodeType)).toBe(true)
  })

  it('strictly validates note data', () => {
    expect(comicNoteNodeType.validateData({ title: 'Beat', text: 'Dialogue' })).toBe(true)
    expect(comicNoteNodeType.validateData(Object.assign(Object.create(null), { title: '', text: '' }))).toBe(true)
    expect(comicNoteNodeType.validateData({ title: 'Beat', text: 'Dialogue', runtime: true })).toBe(false)
    expect(comicNoteNodeType.validateData({ title: 'Beat' })).toBe(false)
    expect(comicNoteNodeType.validateData({ title: 1, text: '' })).toBe(false)
    expect(comicNoteNodeType.validateData([])).toBe(false)
    expect(comicNoteNodeType.validateData(null)).toBe(false)
    expect(comicNoteNodeType.validateData({ title: 'x'.repeat(257), text: '' })).toBe(false)
    expect(comicNoteNodeType.validateData({ title: '', text: 'x'.repeat(100_001) })).toBe(false)
  })

  it('strictly validates asset and safe URL image sources', () => {
    expect(comicImageNodeType.validateData({
      title: 'Panel',
      source: { type: 'asset', assetId: 'asset:panel-1' },
      alt: 'Hero arrives',
    })).toBe(true)
    expect(comicImageNodeType.validateData({
      title: 'Reference',
      source: { type: 'url', url: 'https://example.test/image.png' },
      alt: '',
    })).toBe(true)

    expect(comicImageNodeType.validateData({ title: '', source: { type: 'asset', assetId: '' }, alt: '' })).toBe(false)
    expect(comicImageNodeType.validateData({ title: '', source: { type: 'url', url: 'javascript:alert(1)' }, alt: '' })).toBe(false)
    expect(comicImageNodeType.validateData({ title: '', source: { type: 'url', url: 'https://user:secret@example.test/a' }, alt: '' })).toBe(false)
    expect(comicImageNodeType.validateData({ title: '', source: { type: 'url', url: '/relative.png' }, alt: '' })).toBe(false)
    expect(comicImageNodeType.validateData({ title: '', source: { type: 'url', url: 'https://ok.test/a', extra: true }, alt: '' })).toBe(false)
    expect(comicImageNodeType.validateData({ title: '', source: { type: 'asset', assetId: 'a' }, alt: '', selected: true })).toBe(false)
  })

  it('strictly validates sequence data', () => {
    expect(comicSequenceEdgeType.validateData({ label: 'Next panel' })).toBe(true)
    expect(comicSequenceEdgeType.validateData({ label: '' })).toBe(true)
    expect(comicSequenceEdgeType.validateData({ label: '', animated: true })).toBe(false)
    expect(comicSequenceEdgeType.validateData({ label: 1 })).toBe(false)
    expect(comicSequenceEdgeType.validateData({ label: 'x'.repeat(513) })).toBe(false)
  })
})
