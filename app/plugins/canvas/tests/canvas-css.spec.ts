import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const css = await readFile(new URL('../src/client/canvas.css', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../src/client/CanvasView.tsx', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))
  if (match?.[1] === undefined) throw new Error(`missing CSS rule: ${selector}`)
  return match[1]
}

describe('Canvas viewport CSS contract', () => {
  it('closes the grid height chain so React Flow never mounts into a zero-height stage', () => {
    expect(rule('.cvxWorkbenchCanvas')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasBody')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasStage')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasFlow')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxCanvasStage')).toMatch(/overflow:\s*hidden/u)
    expect(rule('.cvxCanvasStage')).toMatch(/outline:\s*none/u)
  })

  it('uses the entire center surface while preserving a native draggable titlebar', () => {
    expect(rule('.cvxCanvasOverlay')).toMatch(/display:\s*block/u)
    expect(rule('.cvxCanvasOverlay')).not.toMatch(/grid-template-rows/u)
    expect(rule('.cvxCanvasTitlebar')).toMatch(/-webkit-app-region:\s*drag/u)
    expect(rule('.cvxCanvasTitlebar')).toMatch(/height:\s*64px/u)
    expect(rule('.cvxCanvasFloatingTitle')).toMatch(/position:\s*absolute/u)
    expect(rule('.cvxCanvasFloatingTitle')).toMatch(/top:\s*20px/u)
    expect(rule('.cvxCanvasToolbar')).toMatch(/-webkit-app-region:\s*no-drag/u)
  })

  it('keeps the nested Canvases tree inside its sidebar width and host theme', () => {
    expect(rule('.cvxCanvasFileTree')).toMatch(/box-sizing:\s*border-box/u)
    expect(rule('.cvxWorkbench,\n.cvxCanvasOverlay,\n.cvxCanvasLauncher,\n.cvxTreeSection')).toMatch(/--cvx-canvas-accent:\s*var\(--cvx-beui-primary, #18181b\)/u)
    expect(css).not.toMatch(/#5c7a00|#c6f22d/u)
    expect(viewSource).not.toContain('BEUI_THEME_CSS')
    expect(viewSource).not.toContain('BEUI_COMPONENT_CSS')
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
    expect(rule('.cvxCanvasFlow .react-flow__node.resizing .cvxCanvasNodeSurface')).toMatch(/transition:\s*none/u)
  })

  it('matches Convax node chrome and entry motion', () => {
    expect(rule('.cvxCanvasNodeHeader')).toMatch(/bottom:\s*calc\(100% \+ 7px\)/u)
    expect(rule('.cvxCanvasNodeSurface[data-kind="image"]')).toMatch(/border-radius:\s*24px/u)
    expect(rule('.cvxCanvasNode[data-entering] .cvxCanvasNodeEntryShell')).toMatch(/cvx-canvas-node-enter 220ms/u)
    expect(rule('.cvxCanvasHandle')).toMatch(/opacity:\s*0/u)
  })

  it('connects the quick composer focus state to a visible beam animation', () => {
    expect(rule('.cvxCanvasComposerBeam:focus-within::before')).toMatch(/cvx-canvas-beam-spin 1\.6s/u)
    expect(rule('.cvxCanvasComposerSurface input')).toMatch(/caret-color:\s*var\(--cvx-canvas-accent\)/u)
    expect(rule('.cvxCanvasComposer[data-pulse] .cvxCanvasComposerSubmit')).toMatch(/cvx-canvas-submit-pulse/u)
  })
})
