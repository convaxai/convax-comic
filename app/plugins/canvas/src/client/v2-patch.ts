import {
  applyCanvasPatch,
  decodeJsonPointer,
  encodeJsonPointer,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasEdgeUpdate,
  type CanvasNode,
  type CanvasNodeUpdate,
  type CanvasPatchOperation,
  type CanvasViewport,
  type EdgeId,
  type JsonValue,
  type NodeId,
} from '@convax/canvas-api'

const clone = <T>(value: T): T => structuredClone(value)

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function readCanvasPointer(root: unknown, pointer: string): unknown {
  let value = root
  for (const segment of decodeJsonPointer(pointer)) {
    if (typeof value !== 'object' || value === null || !own(value, segment)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

export function applyClientPatch(
  document: CanvasDocument,
  operations: readonly CanvasPatchOperation[],
): CanvasDocument {
  return applyCanvasPatch({ document, operations }).document
}

/** Builds a reverse patch against each operation's exact pre-operation value. */
export function invertCanvasPatch(
  document: CanvasDocument,
  operations: readonly CanvasPatchOperation[],
): CanvasPatchOperation[] {
  const inverse: CanvasPatchOperation[] = []
  let preview = document

  for (const operation of operations) {
    const previous = readCanvasPointer(preview, operation.path)
    if (operation.op === 'add') {
      inverse.unshift({ op: 'remove', path: operation.path })
    } else if (operation.op === 'remove') {
      if (previous === undefined) {
        throw new Error(`Cannot invert missing Canvas path: ${operation.path}`)
      }
      inverse.unshift({
        op: 'add',
        path: operation.path,
        value: clone(previous) as CanvasNode | CanvasEdge,
      } as CanvasPatchOperation)
    } else {
      if (previous === undefined) {
        throw new Error(`Cannot invert missing Canvas path: ${operation.path}`)
      }
      inverse.unshift({
        op: 'replace',
        path: operation.path,
        value: clone(previous) as JsonValue,
      })
    }
    preview = applyClientPatch(preview, [operation])
  }

  return inverse
}

function deterministicLeaves(
  current: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, unknown>>,
  segments: readonly string[],
): CanvasPatchOperation[] {
  const operations: CanvasPatchOperation[] = []
  for (const key of Object.keys(changes).sort()) {
    const next = changes[key]
    if (next === undefined) continue
    const previous = current[key]
    if (previous === undefined) {
      throw new Error(`Canvas leaf does not exist: ${encodeJsonPointer([...segments, key])}`)
    }
    if (
      typeof next === 'object'
      && next !== null
      && !Array.isArray(next)
      && typeof previous === 'object'
      && previous !== null
      && !Array.isArray(previous)
    ) {
      operations.push(...deterministicLeaves(
        previous as Readonly<Record<string, unknown>>,
        next as Readonly<Record<string, unknown>>,
        [...segments, key],
      ))
    } else if (!Object.is(previous, next)) {
      operations.push({
        op: 'replace',
        path: encodeJsonPointer([...segments, key]),
        value: clone(next) as JsonValue,
      })
    }
  }
  return operations
}

/** Emits only Host-supported mutable node leaves in deterministic path order. */
export function nodeUpdatePatch(
  nodeId: NodeId,
  node: CanvasNode,
  changes: CanvasNodeUpdate,
): CanvasPatchOperation[] {
  const mutable = {
    ...(changes.position === undefined ? {} : { position: changes.position }),
    ...(changes.zIndex === undefined ? {} : { zIndex: changes.zIndex }),
    ...(changes.style === undefined ? {} : { style: changes.style }),
    ...(changes.data === undefined ? {} : { data: changes.data }),
  }
  return deterministicLeaves(
    node as unknown as Readonly<Record<string, unknown>>,
    mutable,
    ['nodes', nodeId],
  )
}

/** Emits only Host-supported mutable edge data leaves. */
export function edgeUpdatePatch(
  edgeId: EdgeId,
  edge: CanvasEdge,
  changes: CanvasEdgeUpdate,
): CanvasPatchOperation[] {
  const mutable = changes.data === undefined ? {} : { data: changes.data }
  return deterministicLeaves(
    edge as unknown as Readonly<Record<string, unknown>>,
    mutable,
    ['edges', edgeId],
  )
}

export function viewportPatch(
  current: CanvasViewport,
  next: CanvasViewport,
): CanvasPatchOperation[] {
  return deterministicLeaves(
    current as unknown as Readonly<Record<string, unknown>>,
    next as unknown as Readonly<Record<string, unknown>>,
    ['viewport'],
  )
}

export function nodeRemovePatch(nodeId: NodeId): CanvasPatchOperation {
  return { op: 'remove', path: encodeJsonPointer(['nodes', nodeId]) }
}

export function edgeRemovePatch(edgeId: EdgeId): CanvasPatchOperation {
  return { op: 'remove', path: encodeJsonPointer(['edges', edgeId]) }
}
