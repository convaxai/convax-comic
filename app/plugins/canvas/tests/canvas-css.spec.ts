import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const css = await readFile(new URL('../src/client/canvas.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))
  if (match?.[1] === undefined) throw new Error(`missing CSS rule: ${selector}`)
  return match[1]
}

describe('Canvas viewport CSS contract', () => {
  it('closes the grid height chain so React Flow never mounts into a zero-height stage', () => {
    expect(rule('.cvxCanvasBody')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasStage')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasFlow')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasStage')).toMatch(/overflow:\s*hidden/u)
  })

  it('only shows the grab cursor while Space panning is active', () => {
    expect(rule('.cvxCanvasFlow .react-flow__pane')).toMatch(/cursor:\s*default/u)
    expect(rule('.cvxCanvasStageHand .cvxCanvasFlow .react-flow__pane')).toMatch(/cursor:\s*grab/u)
    expect(rule('.cvxCanvasStageHand .cvxCanvasFlow .react-flow__pane.dragging')).toMatch(/cursor:\s*grabbing/u)
  })

  it('uses the wider invisible Convax resize hit targets without animated geometry', () => {
    expect(rule('.cvxCanvasFlow .react-flow__resize-control.cvxCanvasNodeResizerLine.left,\n.cvxCanvasFlow .react-flow__resize-control.cvxCanvasNodeResizerLine.right')).toMatch(/width:\s*14px/u)
    expect(rule('.cvxCanvasFlow .react-flow__resize-control.cvxCanvasNodeResizerHandle')).toMatch(/width:\s*18px/u)
    expect(rule('.cvxCanvasFlow .react-flow__resize-control.cvxCanvasNodeResizerHandle')).toMatch(/background:\s*transparent\s*!important/u)
    expect(rule('.cvxCanvasFlow .react-flow__node.resizing .cvxCanvasNode')).toMatch(/transition:\s*none/u)
  })
})
