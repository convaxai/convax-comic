import {
  CANVAS_ERROR_CODES,
  CanvasContractError,
  type CanvasEdge,
  type CanvasEdgeTypeDefinition,
  type CanvasNode,
  type CanvasNodeTypeDefinition,
} from '@convax/canvas-api'
import { describe, expect, it } from 'vitest'
import { EdgeTypeRegistry, NodeTypeRegistry } from '../src/host/node-type-registry.ts'

type NoteData = { text: string }
type SequenceData = { label: string }

function noteDefinition(): CanvasNodeTypeDefinition<NoteData> {
  return {
    type: 'comic.note',
    kindVersion: 2,
    createData: () => ({ text: '' }),
    validateData: (data: unknown): data is NoteData => typeof data === 'object'
      && data !== null
      && typeof (data as { text?: unknown }).text === 'string',
  }
}

function noteNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'comic.note',
    kindVersion: 2,
    position: { x: 10, y: 20 },
    zIndex: 0,
    style: {},
    data: { text: 'Opening panel' },
    ...overrides,
  }
}

function sequenceDefinition(): CanvasEdgeTypeDefinition<SequenceData> {
  return {
    type: 'comic.sequence',
    kindVersion: 1,
    createData: () => ({ label: '' }),
    validateData: (data: unknown): data is SequenceData => typeof data === 'object'
      && data !== null
      && typeof (data as { label?: unknown }).label === 'string',
  }
}

function sequenceEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: 'edge-1',
    type: 'comic.sequence',
    kindVersion: 1,
    source: 'node-1',
    target: 'node-2',
    data: { label: 'next' },
    ...overrides,
  }
}

describe('Host Canvas type registries', () => {
  it('coexists across kind versions, rejects exact duplicates, and disposes idempotently', () => {
    const registry = new NodeTypeRegistry()
    const first = noteDefinition()
    const disposeFirst = registry.register(first)
    const next = { ...noteDefinition(), kindVersion: 3 }
    registry.register(next)

    expect(registry.get(first.type, 2)).toMatchObject(first)
    expect(registry.get(first.type, 3)).toMatchObject(next)
    expect(registry.get(first.type)).toMatchObject(next)
    expect(() => registry.register(noteDefinition())).toThrowError(/already registered/u)

    disposeFirst()
    disposeFirst()
    expect(registry.get(first.type, 2)).toBeUndefined()
    expect(registry.get(first.type, 3)).toMatchObject(next)

    const replacement = noteDefinition()
    registry.register(replacement)
    disposeFirst()
    expect(registry.get(replacement.type, 2)).toMatchObject(replacement)
  })

  it('validates new and existing nodes against exact type, version, and data', () => {
    const registry = new NodeTypeRegistry()
    const definition = noteDefinition()
    registry.register(definition)

    expect(() => registry.validateNew(noteNode())).not.toThrow()
    expect(() => registry.validateNew(noteNode({ kindVersion: 1 }))).toThrowError(
      expect.objectContaining({ code: CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED }),
    )
    expect(() => registry.validateNew(noteNode({ data: { text: 42 } }))).toThrowError(
      expect.objectContaining({ code: CANVAS_ERROR_CODES.INVALID_NODE }),
    )
    expect(() => registry.validateNew(noteNode({ type: 'comic.missing' }))).toThrowError(
      expect.objectContaining({ code: CANVAS_ERROR_CODES.NODE_TYPE_NOT_REGISTERED }),
    )
    expect(registry.validateExisting(noteNode({ type: 'comic.unavailable' }))).toBe(false)
    expect(registry.validateExisting(noteNode({ kindVersion: 1 }))).toBe(false)
    expect(() => registry.validateExisting(noteNode({ data: {} }))).toThrow(CanvasContractError)
  })

  it('provides the same lifecycle and exact validation for edge types', () => {
    const registry = new EdgeTypeRegistry()
    const dispose = registry.register(sequenceDefinition())

    expect(() => registry.validateNew(sequenceEdge())).not.toThrow()
    expect(registry.validateExisting(sequenceEdge({ type: 'comic.unavailable' }))).toBe(false)
    expect(() => registry.validateNew(sequenceEdge({ kindVersion: 2 }))).toThrowError(
      expect.objectContaining({ code: CANVAS_ERROR_CODES.EDGE_TYPE_NOT_REGISTERED }),
    )
    expect(() => registry.validateNew(sequenceEdge({ type: 'comic.missing' }))).toThrowError(
      expect.objectContaining({ code: CANVAS_ERROR_CODES.EDGE_TYPE_NOT_REGISTERED }),
    )
    expect(() => registry.register(sequenceDefinition())).toThrow(/already registered/u)

    dispose()
    dispose()
    expect(registry.get('comic.sequence')).toBeUndefined()
  })
})
