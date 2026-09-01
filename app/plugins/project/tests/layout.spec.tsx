import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectShell, ProjectShellView } from '../src/client/components.js'
import {
  DEFAULT_AGENT_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_AGENT_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_AGENT_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  ProjectLayout,
  projectPanelWidthFromPointer,
  resolveProjectPanelColumns,
} from '../src/client/layout.js'

const componentsSource = await readFile(new URL('../src/client/components.tsx', import.meta.url), 'utf8')

function render(layout: ProjectLayout): string {
  return renderToStaticMarkup(
    <ProjectShell
      runtime={{} as never}
      layout={layout}
      renderSlot={(name, owner) => <span data-test-slot={name} data-width={owner.width as number | undefined} />}
    />,
  )
}

function renderAt(layout: ProjectLayout, shellWidth: number): string {
  return renderToStaticMarkup(
    <ProjectShellView
      runtime={{} as never}
      layout={layout}
      shellWidth={shellWidth}
      renderSlot={(name, owner) => (
        <span
          data-test-slot={name}
          data-width={owner.width as number | undefined}
          data-collapsed={owner.collapsed === undefined ? undefined : String(owner.collapsed)}
        />
      )}
    />,
  )
}

describe('Project panel geometry', () => {
  it('returns explicitly collapsed panel widths to the Canvas column', () => {
    const layout = new ProjectLayout()
    const open = render(layout)
    expect(open).toContain('--cvx-sidebar:300px;--cvx-agent:380px')
    expect(open).toContain('aria-label="Resize Project sidebar"')
    expect(open).toContain('aria-label="Resize Agent sidebar"')

    layout.toggleSidebar()
    const leftCollapsed = render(layout)
    expect(leftCollapsed).toContain(`--cvx-sidebar:${SIDEBAR_RAIL_WIDTH}px;--cvx-agent:380px`)
    expect(leftCollapsed).not.toContain('aria-label="Resize Project sidebar"')
    expect(leftCollapsed).toContain('aria-label="Resize Agent sidebar"')

    layout.toggleAgent()
    const collapsed = render(layout)
    expect(collapsed).toContain(`--cvx-sidebar:${SIDEBAR_RAIL_WIDTH}px;--cvx-agent:0px`)
    expect(collapsed).not.toContain('role="separator"')
    expect(collapsed).toContain('aria-label="Expand Agent panel"')
  })

  it('clamps, resets, and preserves preferred widths across explicit collapse', () => {
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

  it('follows compression, Agent concession, rail, and recovery in width order', () => {
    const layout = new ProjectLayout()
    const preference = layout.getSnapshot()

    expect(resolveProjectPanelColumns(preference, 1_200)).toEqual({ sidebar: 300, agent: 380 })

    const compressed = resolveProjectPanelColumns(preference, 900)
    expect(compressed).toEqual({ sidebar: 250, agent: 330 })
    expect(compressed.sidebar).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH)
    expect(compressed.agent).toBeGreaterThanOrEqual(MIN_AGENT_WIDTH)
    expect(compressed.sidebar + compressed.agent + MIN_CENTER_WIDTH).toBe(900)

    expect(resolveProjectPanelColumns(preference, 839)).toEqual({ sidebar: 300, agent: 0 })
    expect(resolveProjectPanelColumns(preference, 539)).toEqual({ sidebar: SIDEBAR_RAIL_WIDTH, agent: 0 })
    expect(resolveProjectPanelColumns(preference, 1_200)).toEqual({ sidebar: 300, agent: 380 })
    expect(layout.getSnapshot()).toBe(preference)
  })

  it('projects width concessions into slot owners without changing preferences', () => {
    const layout = new ProjectLayout()
    expect(renderAt(layout, 1_200)).toContain('--cvx-sidebar:300px;--cvx-agent:380px')

    const compressed = renderAt(layout, 900)
    expect(compressed).toContain('--cvx-sidebar:250px;--cvx-agent:330px')
    expect(compressed).toContain('data-test-slot="sidebar" data-width="250" data-collapsed="false"')
    expect(compressed).toContain('data-test-slot="workbench.agent" data-width="330" data-collapsed="false"')

    const agentConceded = renderAt(layout, 839)
    expect(agentConceded).toContain('data-agent-collapsed="true"')
    expect(agentConceded).toContain('data-test-slot="workbench.agent" data-width="0" data-collapsed="true"')
    expect(agentConceded).not.toContain('aria-label="Resize Agent sidebar"')

    const rail = renderAt(layout, 539)
    expect(rail).toContain('data-sidebar-collapsed="true"')
    expect(rail).toContain(`data-test-slot="sidebar" data-width="${SIDEBAR_RAIL_WIDTH}" data-collapsed="true"`)
    expect(rail).not.toContain('role="separator"')

    expect(renderAt(layout, 1_200)).toContain('--cvx-sidebar:300px;--cvx-agent:380px')
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: 300, agentWidth: 380 })
  })

  it('drives ProjectShell from its observed element width without storing narrow state', () => {
    expect(componentsSource).toContain('new ResizeObserver')
    expect(componentsSource).toContain('entry?.contentRect.width')
    expect(componentsSource).not.toContain('window.innerWidth')
    expect(new ProjectLayout().getSnapshot()).not.toHaveProperty('narrow')
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
