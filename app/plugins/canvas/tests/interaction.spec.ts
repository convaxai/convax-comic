import { describe, expect, it } from 'vitest'
import type { ComicCanvasNode } from '../src/client/comic-ui-contract.ts'
import {
  applyCanvasSelectionChanges,
  CANVAS_NODE_POINTER_POLICY,
  resolveCanvasInteractionPolicy,
  resolveCanvasShortcut,
  tidyCanvasNodes,
} from '../src/client/interaction.ts'

function shortcut(key: string, overrides: Partial<Parameters<typeof resolveCanvasShortcut>[0]> = {}) {
  return resolveCanvasShortcut({
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  })
}

function note(id: string, x: number, y: number, width = 200, height = 120): ComicCanvasNode {
  return { id, kind: 'note', title: id, text: '', position: { x, y }, size: { width, height } }
}

describe('Canvas interaction policy', () => {
  it('keeps one editable mode and temporarily pans while Space is held', () => {
    expect(resolveCanvasInteractionPolicy(false)).toEqual({
      elementsSelectable: true,
      nodesConnectable: true,
      nodesDraggable: true,
      panOnDrag: [1],
      selectionOnDrag: true,
    })
    expect(resolveCanvasInteractionPolicy(true)).toEqual({
      elementsSelectable: false,
      nodesConnectable: false,
      nodesDraggable: false,
      panOnDrag: true,
      selectionOnDrag: false,
    })
  })

  it('has no pointer-distance gap between click selection and drag selection', () => {
    expect(CANVAS_NODE_POINTER_POLICY).toEqual({
      nodeClickDistance: 4,
      nodeDragThreshold: 4,
    })
  })

  it('matches the core Convax canvas shortcuts', () => {
    expect(shortcut('h')).toBeUndefined()
    expect(shortcut('v')).toBeUndefined()
    expect(shortcut('Escape')).toBe('clear-selection')
    expect(shortcut('Delete')).toBe('delete')
    expect(shortcut('0', { metaKey: true })).toBe('fit-view')
    expect(shortcut('=', { ctrlKey: true })).toBe('zoom-in')
    expect(shortcut('-', { metaKey: true })).toBe('zoom-out')
    expect(shortcut('a', { metaKey: true })).toBe('select-all')
    expect(shortcut('d', { ctrlKey: true })).toBe('duplicate')
    expect(shortcut('z', { metaKey: true })).toBe('undo')
    expect(shortcut('z', { metaKey: true, shiftKey: true })).toBe('redo')
    expect(shortcut('f', { altKey: true, shiftKey: true })).toBe('tidy')
    expect(shortcut('ArrowLeft')).toBeUndefined()
    expect(shortcut('ArrowDown', { shiftKey: true })).toBeUndefined()
    expect(shortcut('x', { metaKey: true })).toBeUndefined()
  })

  it('applies rapid React Flow selection changes without lagging one click behind', () => {
    let selected: readonly string[] = []
    selected = applyCanvasSelectionChanges(selected, [{ id: 'a', selected: true }])
    expect(selected).toEqual(['a'])

    selected = applyCanvasSelectionChanges(selected, [
      { id: 'a', selected: false },
      { id: 'b', selected: true },
    ])
    expect(selected).toEqual(['b'])

    selected = applyCanvasSelectionChanges(selected, [
      { id: 'b', selected: false },
      { id: 'c', selected: true },
    ])
    expect(selected).toEqual(['c'])
  })
})

describe('Canvas tidy layout', () => {
  it('produces deterministic non-overlapping horizontal and vertical arrangements', () => {
    const nodes = [
      note('a', 40, 80, 220, 120),
      note('b', 800, 700, 180, 160),
      note('c', -120, 400, 260, 100),
      note('d', 500, -40, 200, 180),
      note('e', 100, 900, 240, 140),
      note('f', 300, 120, 190, 110),
    ]
    const horizontal = tidyCanvasNodes(nodes, 'horizontal')
    const vertical = tidyCanvasNodes(nodes, 'vertical')

    expect(horizontal).toEqual(tidyCanvasNodes(nodes, 'horizontal'))
    expect(horizontal.map(move => move.id)).toEqual(nodes.map(node => node.id))
    expect(vertical).not.toEqual(horizontal)

    const assertNoOverlap = (moves: typeof horizontal): void => {
      for (let left = 0; left < moves.length; left += 1) {
        for (let right = left + 1; right < moves.length; right += 1) {
          const a = nodes[left]
          const b = nodes[right]
          const moveA = moves[left]
          const moveB = moves[right]
          if (a === undefined || b === undefined || moveA === undefined || moveB === undefined) continue
          const separated = moveA.position.x + a.size.width <= moveB.position.x
            || moveB.position.x + b.size.width <= moveA.position.x
            || moveA.position.y + a.size.height <= moveB.position.y
            || moveB.position.y + b.size.height <= moveA.position.y
          expect(separated).toBe(true)
        }
      }
    }
    assertNoOverlap(horizontal)
    assertNoOverlap(vertical)
  })
})
