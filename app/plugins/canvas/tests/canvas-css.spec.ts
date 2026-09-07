import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const css = await readFile(new URL('../src/client/canvas.css', import.meta.url), 'utf8')
const viewSource = await readFile(new URL('../src/client/CanvasView.tsx', import.meta.url), 'utf8')
const workbenchSource = await readFile(new URL('../src/client/Workbench.tsx', import.meta.url), 'utf8')

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

  it('aligns the top creation bar with BeUI and omits duplicate/delete entries', () => {
    expect(rule('.cvxCanvasToolbar')).toMatch(/--cvx-canvas-action-highlight:\s*color-mix\(in oklab, var\(--cvx-beui-primary,[^;]+\) 7%, transparent\)/u)
    expect(rule('.cvxCanvasToolbar')).toMatch(/top:\s*16px[^}]*min-height:\s*44px[^}]*gap:\s*6px[^}]*padding:\s*6px/su)
    expect(rule('.cvxCanvasToolbar')).toMatch(/box-sizing:\s*border-box[^}]*border:\s*1px solid var\(--cvx-beui-border,[^}]*border-radius:\s*var\(--cvx-beui-radius-pill, 999px\)/su)
    expect(rule('.cvxCanvasToolbar')).toMatch(/background:\s*color-mix\(in oklab, var\(--cvx-beui-card,[^;]+\) 90%, transparent\)[^}]*backdrop-filter:\s*blur\(24px\)/su)
    expect(rule('.cvxCanvasToolbar .cvxCanvasButton.cvxBeuiButton[data-variant="ghost"]:hover:not(:disabled)')).toMatch(/border-color:\s*transparent[^}]*color:\s*var\(--cvx-beui-foreground,[^}]*background:\s*var\(--cvx-canvas-action-highlight\)/su)
    expect(viewSource).not.toContain('aria-label="复制所选节点"')
    expect(viewSource).not.toContain('aria-label="删除所选内容"')
    expect(viewSource).not.toContain('function DuplicateIcon')
    expect(viewSource).not.toContain('function TrashIcon')
    expect(viewSource).toContain("if (command === 'duplicate') duplicateSelection()")
    expect(viewSource).toContain("else if (command === 'delete') deleteSelection()")
    expect(css).not.toContain('.cvxCanvasSelectionActions')
    expect(css).not.toContain('.cvxCanvasButtonDanger')
  })

  it('keeps the nested Canvases tree inside its sidebar width and host theme', () => {
    expect(rule('.cvxCanvasFileTree')).toMatch(/box-sizing:\s*border-box/u)
    expect(rule('.cvxCanvasOverlay,\n.cvxCanvasLauncher,\n.cvxTreeSection')).toMatch(/--cvx-canvas-accent:\s*var\(--cvx-beui-primary, #18181b\)/u)
    expect(workbenchSource).toContain('<AnimatedSidebarMenuItem')
    expect(workbenchSource).toContain('className="cvxCanvasSectionItem"')
    expect(workbenchSource).toContain('variant="section"')
    expect(workbenchSource).toContain('<AnimatedSidebarSubmenu expanded={expanded} className="cvxCanvasSectionMotion">')
    expect(workbenchSource).not.toContain('{expanded && (')
    expect(rule('.cvxTreeAdd')).toMatch(/place-items:\s*center/u)
    expect(rule('.cvxTreeError')).toMatch(/color:\s*var\(--cvx-canvas-danger\)/u)
    expect(workbenchSource).toContain('workspace.getMediaPreviewUrl(node.id)')
    expect(workbenchSource).toContain('className="cvxCanvasTreeImagePreview"')
    expect(workbenchSource).toContain('className="cvxCanvasTreeTextPreview"')
    expect(rule('.cvxCanvasTreeImagePreview')).toMatch(/object-fit:\s*cover/u)
    expect(css).toMatch(/\.cvxCanvasTreeTextPreview\s*\{[^}]*font-size:\s*6px/su)
    expect(css).not.toMatch(/#5c7a00|#c6f22d/u)
    expect(viewSource).not.toContain('BEUI_THEME_CSS')
    expect(viewSource).not.toContain('BEUI_COMPONENT_CSS')
  })

  it('does not retain selectors for the removed Canvas workbench shell', () => {
    expect(css).not.toContain('.cvxWorkbench,')
    expect(css).not.toContain('.cvxWorkbench {')
    expect(css).not.toContain('.cvxWorkbench[')
    expect(css).not.toContain('.cvxWorkbenchResizeHandle')
    expect(css).not.toContain('.cvxWorkbenchAgent')
    expect(css).not.toContain('.cvxAgentNewSession')
    expect(css).not.toContain('.cvxTreeItem')
    expect(css).not.toContain('.cvxProjectRail')
  })

  it('aligns the bottom-left viewport bar and its states with BeUI', () => {
    expect(rule('.cvxViewportToolbar')).toMatch(/--cvx-canvas-action-highlight:\s*color-mix\(in oklab, var\(--cvx-beui-primary,[^;]+\) 7%, transparent\)/u)
    expect(rule('.cvxViewportToolbar')).toMatch(/left:\s*16px[^}]*bottom:\s*16px[^}]*min-height:\s*44px[^}]*gap:\s*6px[^}]*padding:\s*6px/su)
    expect(rule('.cvxViewportToolbar')).toMatch(/box-sizing:\s*border-box[^}]*border:\s*1px solid var\(--cvx-beui-border,[^}]*border-radius:\s*var\(--cvx-beui-radius-pill, 999px\)/su)
    expect(rule('.cvxViewportToolbar')).toMatch(/background:\s*color-mix\(in oklab, var\(--cvx-beui-card,[^;]+\) 90%, transparent\)[^}]*backdrop-filter:\s*blur\(24px\)/su)
    expect(rule('.cvxViewportToolbar .cvxCanvasIconButton.cvxBeuiButton[data-variant="ghost"]:hover:not(:disabled),\n.cvxViewportToolbar .cvxZoomTrigger:hover,\n.cvxViewportToolbar .cvxZoomTrigger[aria-expanded="true"],\n.cvxViewportToolbar .cvxCanvasIconButton[data-active="true"],\n.cvxViewportToolbar .cvxCanvasIconButton[data-active="true"]:hover:not(:disabled)')).toMatch(/border-color:\s*transparent[^}]*color:\s*var\(--cvx-beui-foreground,[^}]*background:\s*var\(--cvx-canvas-action-highlight\)/su)
    expect(rule('.cvxLayoutControl:hover,\n.cvxLayoutControl:has(.cvxLayoutDirectionTrigger[aria-expanded="true"])')).toMatch(/background:\s*var\(--cvx-canvas-action-highlight\)/u)
    const viewportToolbarSource = viewSource.slice(viewSource.indexOf('function ViewportToolbar'))
    expect(viewportToolbarSource.match(/whileHover=\{\{ scale: 1 \}\}/gu)).toHaveLength(7)
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

  it('drops directly at the React Flow pointer projection without a hint overlay', () => {
    expect(viewSource).toContain('instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })')
    expect(viewSource).toContain("event.dataTransfer.dropEffect = 'copy'")
    expect(viewSource).not.toContain('dragActive')
    expect(viewSource).not.toContain('dragDepth')
    expect(viewSource).not.toContain('onDragEnter')
    expect(viewSource).not.toContain('onDragLeave')
    expect(viewSource).not.toContain('cvxCanvasDropCue')
    expect(css).not.toContain('.cvxCanvasDropCue')
  })

  it('does not render or style the removed quick-generation input', () => {
    expect(viewSource).not.toContain('cvxCanvasComposer')
    expect(viewSource).not.toContain('快速创建灵感卡片')
    expect(css).not.toContain('.cvxCanvasComposer')
    expect(css).not.toContain('cvx-canvas-composer')
  })
})
