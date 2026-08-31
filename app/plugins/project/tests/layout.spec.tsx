import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ProjectShell } from '../src/client/components.js'
import { ProjectLayout } from '../src/client/layout.js'

function render(layout: ProjectLayout): string {
  return renderToStaticMarkup(
    <ProjectShell
      runtime={{} as never}
      layout={layout}
      renderSlot={(name) => <span data-test-slot={name} />}
    />,
  )
}

describe('Project panel geometry', () => {
  it('returns both collapsed panel widths to the Canvas column', () => {
    const layout = new ProjectLayout()
    expect(render(layout)).toContain('--cvx-sidebar:300px;--cvx-agent:380px')

    layout.toggleSidebar()
    expect(render(layout)).toContain('--cvx-sidebar:56px;--cvx-agent:380px')

    layout.toggleAgent()
    const collapsed = render(layout)
    expect(collapsed).toContain('--cvx-sidebar:56px;--cvx-agent:0px')
    expect(collapsed).toContain('aria-label="Expand Agent panel"')
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
