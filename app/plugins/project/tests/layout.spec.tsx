import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectShell } from '../src/client/components.js'
import {
  DEFAULT_AGENT_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_AGENT_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_AGENT_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_SIDEBAR_WIDTH,
  ProjectLayout,
  projectPanelWidthFromPointer,
  resolveProjectPanelColumns,
} from '../src/client/layout.js'

function render(layout: ProjectLayout): string {
  return renderToStaticMarkup(
    <ProjectShell
      runtime={{} as never}
      layout={layout}
      renderSlot={(name, owner) => <span data-test-slot={name} data-width={owner.width as number | undefined} />}
    />,
  )
}

describe('Project panel geometry', () => {
  it('returns both collapsed panel widths to the Canvas column', () => {
    const layout = new ProjectLayout()
    const open = render(layout)
    expect(open).toContain('--cvx-sidebar:300px;--cvx-agent:380px')
    expect(open).toContain('aria-label="Resize Project sidebar"')
    expect(open).toContain('aria-label="Resize Agent sidebar"')

    layout.toggleSidebar()
    const leftCollapsed = render(layout)
    expect(leftCollapsed).toContain('--cvx-sidebar:56px;--cvx-agent:380px')
    expect(leftCollapsed).not.toContain('aria-label="Resize Project sidebar"')
    expect(leftCollapsed).toContain('aria-label="Resize Agent sidebar"')

    layout.toggleAgent()
    const collapsed = render(layout)
    expect(collapsed).toContain('--cvx-sidebar:56px;--cvx-agent:0px')
    expect(collapsed).not.toContain('role="separator"')
    expect(collapsed).toContain('aria-label="Expand Agent panel"')
  })

  it('clamps, resets, and preserves preferred widths across collapse', () => {
    const layout = new ProjectLayout()
    layout.resizeSidebar(9_999)
    layout.resizeAgent(-20)
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: MAX_SIDEBAR_WIDTH, agentWidth: MIN_AGENT_WIDTH })

    layout.toggleSidebar()
    layout.toggleSidebar()
    layout.toggleAgent()
    layout.toggleAgent()
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: MAX_SIDEBAR_WIDTH, agentWidth: MIN_AGENT_WIDTH })
    expect(render(layout)).toContain(`--cvx-sidebar:${MAX_SIDEBAR_WIDTH}px;--cvx-agent:${MIN_AGENT_WIDTH}px`)

    layout.resizeSidebar(Number.NaN)
    layout.resizeAgent(Number.POSITIVE_INFINITY)
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: MIN_SIDEBAR_WIDTH, agentWidth: MIN_AGENT_WIDTH })
    layout.resetSidebarWidth()
    layout.resetAgentWidth()
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, agentWidth: DEFAULT_AGENT_WIDTH })
  })

  it('keeps the Canvas minimum best-effort and restores preferred widths as space returns', () => {
    const layout = new ProjectLayout()
    layout.resizeSidebar(MAX_SIDEBAR_WIDTH)
    layout.resizeAgent(MAX_AGENT_WIDTH)
    const narrow = resolveProjectPanelColumns(layout.getSnapshot(), 1_280)
    expect(narrow.sidebar).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
    expect(narrow.agent).toBeGreaterThanOrEqual(MIN_AGENT_WIDTH)
    expect(narrow.sidebar + narrow.agent + MIN_CENTER_WIDTH).toBe(1_280)

    expect(resolveProjectPanelColumns(layout.getSnapshot(), 1_600)).toEqual({
      sidebar: MAX_SIDEBAR_WIDTH,
      agent: MAX_AGENT_WIDTH,
    })
    layout.toggleSidebar()
    expect(resolveProjectPanelColumns(layout.getSnapshot(), 1_280)).toEqual({ sidebar: 56, agent: MAX_AGENT_WIDTH })
  })

  it('applies pointer deltas in opposite directions at the two boundaries', () => {
    expect(projectPanelWidthFromPointer('sidebar', 300, 300, 360)).toBe(360)
    expect(projectPanelWidthFromPointer('sidebar', 300, 300, 240)).toBe(240)
    expect(projectPanelWidthFromPointer('agent', 380, 900, 840)).toBe(440)
    expect(projectPanelWidthFromPointer('agent', 380, 900, 960)).toBe(320)
  })

  it('publishes panel transitions and reopens Agent for details', () => {
    const layout = new ProjectLayout()
    const listener = vi.fn()
    const dispose = layout.subscribe(listener)

    layout.toggleAgent()
    expect(layout.getSnapshot().agentOpen).toBe(false)
    layout.openDetails()
    expect(layout.getSnapshot()).toMatchObject({ agentOpen: true, detailsOpen: true })
    expect(listener).toHaveBeenCalledTimes(2)

    dispose()
    layout.toggleSidebar()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
