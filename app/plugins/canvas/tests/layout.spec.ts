import { describe, expect, it } from 'vitest'
import {
  AGENT_MIN_WIDTH,
  SIDEBAR_COLLAPSED_WIDTH,
  WorkbenchLayout,
  solveWorkbenchColumns,
} from '../src/client/layout.ts'

describe('workbench panel geometry', () => {
  it('uses the DSH concession order and restores from preferred widths', () => {
    expect(solveWorkbenchColumns(1440, 280, 380)).toEqual({ sidebar: 280, center: 780, agent: 380 })
    expect(solveWorkbenchColumns(1280, 280, 420)).toEqual({
      sidebar: 280,
      center: 640,
      agent: 360,
    })
    expect(solveWorkbenchColumns(1180, 280, 420)).toEqual({ sidebar: 280, center: 900, agent: 0 })
    expect(solveWorkbenchColumns(900, 0, 380)).toEqual({
      sidebar: SIDEBAR_COLLAPSED_WIDTH,
      center: 844,
      agent: 0,
    })
  })

  it('keeps the official layout face stable across narrow and resize transitions', () => {
    const layout = new WorkbenchLayout()
    layout.setNarrow(true)
    layout.toggleSidebar()
    expect(layout.getSnapshot()).toMatchObject({ narrow: true, narrowExpanded: true, sidebarOpen: true })
    layout.setSidebarWidth(999)
    layout.setAgentWidth(1)
    expect(layout.getSnapshot()).toMatchObject({ sidebarWidth: 420, agentWidth: AGENT_MIN_WIDTH })
    layout.openDetails()
    expect(layout.getSnapshot().detailsOpen).toBe(true)
    layout.closeDetails()
    expect(layout.getSnapshot().detailsOpen).toBe(false)
  })
})
