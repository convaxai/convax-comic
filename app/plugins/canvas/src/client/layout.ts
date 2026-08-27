export interface WorkbenchLayoutSnapshot {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly narrow: boolean
  readonly narrowExpanded: boolean
  readonly agentOpen: boolean
  readonly agentWidth: number
  readonly detailsOpen: boolean
}

export interface WorkbenchColumns {
  readonly sidebar: number
  readonly center: number
  readonly agent: number
}

type LayoutListener = () => void

export const SIDEBAR_COLLAPSED_WIDTH = 56
export const SIDEBAR_DEFAULT_WIDTH = 280
export const SIDEBAR_MIN_WIDTH = 264
export const SIDEBAR_MAX_WIDTH = 420
export const AGENT_DEFAULT_WIDTH = 380
export const AGENT_MIN_WIDTH = 340
export const AGENT_MAX_WIDTH = 520
export const WORKBENCH_CENTER_MIN_WIDTH = 640
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

/**
 * Follow DSH's concession order: preserve the sidebar rail, shrink the right
 * panel first, then visually close it while retaining its preferred width.
 */
export function solveWorkbenchColumns(viewport: number, sidebar: number, agent: number): WorkbenchColumns {
  const resolvedSidebar = sidebar === 0
    ? SIDEBAR_COLLAPSED_WIDTH
    : clamp(sidebar, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
  const preferredAgent = agent === 0 ? 0 : clamp(agent, AGENT_MIN_WIDTH, AGENT_MAX_WIDTH)
  if (resolvedSidebar + preferredAgent + WORKBENCH_CENTER_MIN_WIDTH <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: viewport - resolvedSidebar - preferredAgent,
      agent: preferredAgent,
    }
  }
  const shrunkenAgent = preferredAgent === 0
    ? 0
    : Math.max(AGENT_MIN_WIDTH, viewport - resolvedSidebar - WORKBENCH_CENTER_MIN_WIDTH)
  if (resolvedSidebar + shrunkenAgent + WORKBENCH_CENTER_MIN_WIDTH <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: WORKBENCH_CENTER_MIN_WIDTH,
      agent: shrunkenAgent,
    }
  }
  return {
    sidebar: resolvedSidebar,
    center: Math.max(0, viewport - resolvedSidebar),
    agent: 0,
  }
}

/**
 * DSH-compatible outward layout face plus product-owned panel geometry. The
 * official sidebar and conversation plugins only use toggleSidebar,
 * openDetails, and closeDetails; the root shell owns widths and concessions.
 */
export class WorkbenchLayout {
  readonly #listeners = new Set<LayoutListener>()
  #snapshot: WorkbenchLayoutSnapshot = {
    sidebarOpen: true,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    narrow: false,
    narrowExpanded: false,
    agentOpen: true,
    agentWidth: AGENT_DEFAULT_WIDTH,
    detailsOpen: false,
  }

  readonly subscribe = (listener: LayoutListener): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  readonly getSnapshot = (): WorkbenchLayoutSnapshot => this.#snapshot

  toggleSidebar(): void {
    if (this.#snapshot.narrow) {
      this.#update({ ...this.#snapshot, narrowExpanded: !this.#snapshot.narrowExpanded })
      return
    }
    this.#update({ ...this.#snapshot, sidebarOpen: !this.#snapshot.sidebarOpen })
  }

  setNarrow(narrow: boolean): void {
    if (this.#snapshot.narrow === narrow) return
    this.#update({ ...this.#snapshot, narrow, narrowExpanded: false })
  }

  setSidebarWidth(width: number): void {
    this.#update({
      ...this.#snapshot,
      sidebarOpen: true,
      sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH),
    })
  }

  setAgentWidth(width: number): void {
    this.#update({
      ...this.#snapshot,
      agentOpen: true,
      agentWidth: clamp(width, AGENT_MIN_WIDTH, AGENT_MAX_WIDTH),
    })
  }

  openDetails(): void {
    if (!this.#snapshot.detailsOpen) this.#update({ ...this.#snapshot, detailsOpen: true })
  }

  closeDetails(): void {
    if (this.#snapshot.detailsOpen) this.#update({ ...this.#snapshot, detailsOpen: false })
  }

  dispose(): void {
    this.#listeners.clear()
  }

  #update(snapshot: WorkbenchLayoutSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener()
  }
}
