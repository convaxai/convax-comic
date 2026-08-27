import { describe, expect, it } from 'vitest'
import {
  CANVAS_DOCUMENT_VERSION,
  CANVAS_PROJECT_VERSION,
  CANVAS_DROP_MIME_V1,
  MAX_CANVAS_DOCUMENT_BYTES,
  MAX_CANVAS_NODES,
  CanvasSchemaError,
  parseCanvasDocument,
  parseCanvasDropPayload,
  parseCanvasProject,
  serializeCanvasDocument,
  serializeCanvasDropPayload,
  serializeCanvasProject,
  type CanvasDocumentV1,
} from '../src/schema.ts'

const document: CanvasDocumentV1 = {
  version: CANVAS_DOCUMENT_VERSION,
  id: 'canvas:one',
  title: 'Storyboard',
  viewport: { x: 14, y: -8, zoom: 1.25 },
  nodes: [
    {
      id: 'node:note',
      kind: 'note',
      position: { x: 10, y: 20 },
      size: { width: 280, height: 180 },
      title: 'Opening',
      text: 'A quiet street.',
    },
    {
      id: 'node:image',
      kind: 'image',
      position: { x: 320, y: 20 },
      size: { width: 320, height: 240 },
      title: 'Reference',
      source: { type: 'asset', assetId: 'asset:sha256:abc' },
      alt: 'Night street',
    },
    {
      id: 'node:video',
      kind: 'video',
      position: { x: 680, y: 20 },
      size: { width: 360, height: 240 },
      title: 'Motion reference',
      source: { type: 'url', url: 'https://media.example/video.mp4?token=opaque' },
    },
  ],
  edges: [
    {
      id: 'edge:one',
      source: 'node:note',
      target: 'node:image',
      sourceHandle: 'out',
      targetHandle: 'in',
    },
  ],
}

describe('CanvasDocumentV1', () => {
  it('round-trips a clean discriminated document', () => {
    const serialized = serializeCanvasDocument(document)
    const parsed = parseCanvasDocument(serialized)

    expect(parsed).toEqual(document)
    expect(JSON.parse(serialized)).toEqual(document)
    expect(serialized).not.toContain('selected')
    expect(serialized).not.toContain('measured')
    expect(serialized).not.toContain('blob:')
  })

  it('rejects unknown React Flow state instead of silently persisting it', () => {
    const polluted = {
      ...document,
      nodes: [{ ...document.nodes[0], selected: true }],
      edges: [],
    }

    expect(() => parseCanvasDocument(polluted)).toThrowError(/selected: unknown field/u)
    expect(() => serializeCanvasDocument(polluted as CanvasDocumentV1)).toThrowError(CanvasSchemaError)
  })

  it('rejects non-http media sources, bad graph references, and unsupported versions', () => {
    expect(() => parseCanvasDocument({
      ...document,
      nodes: [{
        ...document.nodes[2],
        source: { type: 'url', url: 'blob:temporary-preview' },
      }],
      edges: [],
    })).toThrowError(/only http and https/u)

    expect(() => parseCanvasDocument({
      ...document,
      edges: [{ id: 'edge:bad', source: 'node:missing', target: 'node:image' }],
    })).toThrowError(/references a missing node/u)

    expect(() => parseCanvasDocument({ ...document, version: 2 })).toThrowError(/unsupported version/u)
  })

  it('rejects duplicate ids, non-finite geometry, and URL credentials', () => {
    expect(() => parseCanvasDocument({
      ...document,
      nodes: [document.nodes[0], { ...document.nodes[0] }],
      edges: [],
    })).toThrowError(/duplicate node id/u)
    expect(() => parseCanvasDocument({
      ...document,
      viewport: { x: 0, y: 0, zoom: Number.NaN },
    })).toThrowError(/finite number/u)
    expect(() => parseCanvasDocument({
      ...document,
      nodes: [{
        ...document.nodes[2],
        source: { type: 'url', url: 'https://user:password@example.test/video.mp4' },
      }],
      edges: [],
    })).toThrowError(/credentials/u)
  })

  it('bounds document bytes and graph cardinality', () => {
    expect(() => parseCanvasDocument(' '.repeat(MAX_CANVAS_DOCUMENT_BYTES + 1))).toThrowError(/payload exceeds/u)
    expect(() => parseCanvasDocument({
      ...document,
      nodes: Array.from({ length: MAX_CANVAS_NODES + 1 }, (_, index) => ({
        id: `node:${index}`,
        kind: 'note',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        title: '',
        text: '',
      })),
    })).toThrowError(`at most ${MAX_CANVAS_NODES} nodes`)
  })
})

describe('CanvasProjectV1', () => {
  it('round-trips multiple strict canvas documents with one active id', () => {
    const second = { ...document, id: 'canvas:two', title: 'Shots', nodes: [], edges: [] }
    const project = {
      version: CANVAS_PROJECT_VERSION,
      id: 'project:comic',
      activeCanvasId: second.id,
      canvases: [document, second],
    }
    expect(parseCanvasProject(serializeCanvasProject(project))).toEqual(project)
  })

  it('rejects duplicate or missing active canvases and project UI state', () => {
    expect(() => parseCanvasProject({
      version: 1,
      id: 'project:comic',
      activeCanvasId: document.id,
      canvases: [document, document],
    })).toThrowError(/duplicate canvas id/u)
    expect(() => parseCanvasProject({
      version: 1,
      id: 'project:comic',
      activeCanvasId: 'canvas:missing',
      canvases: [document],
    })).toThrowError(/references a missing canvas/u)
    expect(() => parseCanvasProject({
      version: 1,
      id: 'project:comic',
      activeCanvasId: document.id,
      canvases: [document],
      expanded: true,
    })).toThrowError(/expanded: unknown field/u)
  })
})

describe('versioned canvas drag payload', () => {
  it('uses an explicit v1 MIME contract and produces a creatable node payload', () => {
    expect(CANVAS_DROP_MIME_V1).toBe('application/vnd.convax.canvas-node.v1+json')
    const value = {
      version: 1 as const,
      kind: 'image' as const,
      title: 'Dropped reference',
      source: { type: 'url' as const, url: 'https://example.test/reference.png' },
      alt: 'Reference',
    }

    expect(parseCanvasDropPayload(serializeCanvasDropPayload(value))).toEqual(value)
  })

  it('rejects future versions, transient URLs, and extra fields', () => {
    expect(() => parseCanvasDropPayload(JSON.stringify({
      version: 2,
      kind: 'note',
      title: 'Future',
      text: '',
    }))).toThrowError(/unsupported version/u)
    expect(() => parseCanvasDropPayload({
      version: 1,
      kind: 'video',
      title: 'Local',
      source: { type: 'url', url: 'file:///private/movie.mp4' },
    })).toThrowError(/only http and https/u)
    expect(() => parseCanvasDropPayload({
      version: 1,
      kind: 'note',
      title: 'Polluted',
      text: '',
      file: new File(['x'], 'secret.txt'),
    })).toThrowError(/file: unknown field/u)
  })
})
