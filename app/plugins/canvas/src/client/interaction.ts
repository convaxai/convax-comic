import type { CanvasMoveNodeInput, ComicCanvasNode } from './comic-ui-contract.js'

export type CanvasLayoutDirection = 'horizontal' | 'vertical'

export interface CanvasElementSelectionChange {
  readonly id: string
  readonly selected: boolean
}

/**
 * D3 suppresses click above nodeClickDistance while React Flow starts a drag
 * only above nodeDragThreshold. These values must stay equal or pointer jitter
 * falls into a dead zone where neither click selection nor drag selection runs.
 */
export const CANVAS_NODE_POINTER_POLICY = Object.freeze({
  nodeClickDistance: 4,
  nodeDragThreshold: 4,
})

export type CanvasShortcutCommand =
  | 'clear-selection'
  | 'delete'
  | 'duplicate'
  | 'fit-view'
  | 'redo'
  | 'select-all'
  | 'tidy'
  | 'undo'
  | 'zoom-in'
  | 'zoom-out'

export function resolveCanvasInteractionPolicy(spacePanning: boolean) {
  return Object.freeze({
    elementsSelectable: !spacePanning,
    nodesConnectable: !spacePanning,
    nodesDraggable: !spacePanning,
    panOnDrag: spacePanning ? true : [1],
    selectionOnDrag: !spacePanning,
  })
}

/** Apply React Flow's synchronous select changes without waiting for its effect-based selection listener. */
export function applyCanvasSelectionChanges(
  currentIds: readonly string[],
  changes: readonly CanvasElementSelectionChange[],
): readonly string[] {
  const ids = new Set(currentIds)
  for (const change of changes) {
    if (change.selected) ids.add(change.id)
    else ids.delete(change.id)
  }
  return Object.freeze([...ids])
}

export function resolveCanvasShortcut(input: {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}): CanvasShortcutCommand | undefined {
  const key = input.key.toLowerCase()
  const primary = input.metaKey || input.ctrlKey
  if (input.altKey && input.shiftKey && !primary && key === 'f') return 'tidy'
  if (primary && !input.altKey) {
    if (key === '0') return 'fit-view'
    if (key === '=' || key === '+') return 'zoom-in'
    if (key === '-' || key === '_') return 'zoom-out'
    if (key === 'a') return 'select-all'
    if (key === 'd') return 'duplicate'
    if (key === 'z') return input.shiftKey ? 'redo' : 'undo'
    if (key === 'y') return 'redo'
  }
  if (primary || input.altKey || input.shiftKey) return undefined
  if (key === 'escape') return 'clear-selection'
  if (key === 'backspace' || key === 'delete') return 'delete'
  return undefined
}

/** A deterministic, dependency-free tidy pass suitable for the current flat Canvas schema. */
export function tidyCanvasNodes(
  nodes: readonly ComicCanvasNode[],
  direction: CanvasLayoutDirection,
): readonly CanvasMoveNodeInput[] {
  if (nodes.length === 0) return Object.freeze([])
  const minimumX = Math.min(...nodes.map(node => node.position.x))
  const minimumY = Math.min(...nodes.map(node => node.position.y))
  const columns = Math.max(1, Math.min(
    nodes.length,
    Math.ceil(Math.sqrt(nodes.length * (direction === 'horizontal' ? 1.6 : 0.625))),
  ))
  const rows = Math.ceil(nodes.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node === undefined) continue
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, node.size.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.size.height)
  }
  const xOffsets: number[] = []
  const yOffsets: number[] = []
  for (let index = 0, offset = minimumX; index < columns; index += 1) {
    xOffsets.push(offset)
    offset += (columnWidths[index] ?? 0) + 80
  }
  for (let index = 0, offset = minimumY; index < rows; index += 1) {
    yOffsets.push(offset)
    offset += (rowHeights[index] ?? 0) + 64
  }
  return Object.freeze(nodes.map((node, index) => Object.freeze({
    id: node.id,
    position: {
      x: Math.round(xOffsets[index % columns] ?? minimumX),
      y: Math.round(yOffsets[Math.floor(index / columns)] ?? minimumY),
    },
  })))
}
