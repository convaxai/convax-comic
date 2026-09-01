type Listener = () => void

export const DEFAULT_SIDEBAR_WIDTH = 300
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 520
export const SIDEBAR_RAIL_WIDTH = 56
export const DEFAULT_AGENT_WIDTH = 380
export const MIN_AGENT_WIDTH = 300
export const MAX_AGENT_WIDTH = 640
export const MIN_CENTER_WIDTH = 320

export function projectPanelWidthFromPointer(
  side: 'sidebar' | 'agent',
  startWidth: number,
  startX: number,
  currentX: number,
): number {
  const delta = currentX - startX
  return startWidth + (side === 'sidebar' ? delta : -delta)
}

export interface ProjectLayoutSnapshot {
  readonly sidebarOpen: boolean
  readonly sidebarWidth: number
  readonly agentOpen: boolean
  readonly agentWidth: number
  readonly detailsOpen: boolean
}

function clampWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export interface ProjectPanelColumns {
  readonly sidebar: number
  readonly agent: number
}

function compressedPanelWidths(
  panelBudget: number,
  minimumSidebar: number,
  minimumAgent: number,
  preferredSidebar: number,
  preferredAgent: number,
): ProjectPanelColumns {
  const sidebarCapacity = preferredSidebar - minimumSidebar
  const agentCapacity = preferredAgent - minimumAgent
  const totalCapacity = sidebarCapacity + agentCapacity
  if (totalCapacity <= 0) return { sidebar: minimumSidebar, agent: minimumAgent }

  const spare = panelBudget - minimumSidebar - minimumAgent
  const sidebarSpare = Math.min(sidebarCapacity, Math.round(spare * sidebarCapacity / totalCapacity))
  const sidebar = minimumSidebar + sidebarSpare
  return { sidebar, agent: panelBudget - sidebar }
}

/**
 * Resolve rendered columns from preferences without mutating those preferences.
 * The concession order follows DSH: compress open panels to their minima, then
 * visually close Agent, and only collapse the sidebar to its 56 px rail when
 * the preferred/minimum sidebar can no longer preserve the Canvas floor.
 */
export function resolveProjectPanelColumns(
  state: Pick<ProjectLayoutSnapshot, 'sidebarOpen' | 'sidebarWidth' | 'agentOpen' | 'agentWidth'>,
  shellWidth: number,
): ProjectPanelColumns {
  const preferredSidebar = state.sidebarOpen
    ? clampWidth(state.sidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
    : SIDEBAR_RAIL_WIDTH
  const preferredAgent = state.agentOpen
    ? clampWidth(state.agentWidth, MIN_AGENT_WIDTH, MAX_AGENT_WIDTH)
    : 0
  if (!Number.isFinite(shellWidth) || shellWidth <= 0) {
    return { sidebar: preferredSidebar, agent: preferredAgent }
  }

  const viewport = Math.round(shellWidth)
  if (preferredSidebar + preferredAgent + MIN_CENTER_WIDTH <= viewport) {
    return { sidebar: preferredSidebar, agent: preferredAgent }
  }

  const minimumSidebar = state.sidebarOpen ? MIN_SIDEBAR_WIDTH : SIDEBAR_RAIL_WIDTH
  const minimumAgent = state.agentOpen ? MIN_AGENT_WIDTH : 0
  const panelBudget = viewport - MIN_CENTER_WIDTH
  if (state.agentOpen && panelBudget >= minimumSidebar + minimumAgent) {
    return compressedPanelWidths(
      panelBudget,
      minimumSidebar,
      minimumAgent,
      preferredSidebar,
      preferredAgent,
    )
  }

  if (!state.sidebarOpen) return { sidebar: SIDEBAR_RAIL_WIDTH, agent: 0 }
  if (preferredSidebar + MIN_CENTER_WIDTH <= viewport) {
    return { sidebar: preferredSidebar, agent: 0 }
  }
  if (MIN_SIDEBAR_WIDTH + MIN_CENTER_WIDTH <= viewport) {
    return { sidebar: viewport - MIN_CENTER_WIDTH, agent: 0 }
  }
  return { sidebar: SIDEBAR_RAIL_WIDTH, agent: 0 }
}

/** Official outward layout face plus the user preferences used by the project shell. */
export class ProjectLayout {
  readonly #listeners = new Set<Listener>()
  #snapshot: ProjectLayoutSnapshot = Object.freeze({
    sidebarOpen: true,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    agentOpen: true,
    agentWidth: DEFAULT_AGENT_WIDTH,
    detailsOpen: false,
  })

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  readonly getSnapshot = (): ProjectLayoutSnapshot => this.#snapshot

  toggleSidebar(): void { this.#update({ ...this.#snapshot, sidebarOpen: !this.#snapshot.sidebarOpen }) }
  toggleAgent(): void { this.#update({ ...this.#snapshot, agentOpen: !this.#snapshot.agentOpen }) }
  resizeSidebar(width: number): void {
    this.#update({ ...this.#snapshot, sidebarWidth: clampWidth(width, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH) })
  }
  resizeAgent(width: number): void {
    this.#update({ ...this.#snapshot, agentWidth: clampWidth(width, MIN_AGENT_WIDTH, MAX_AGENT_WIDTH) })
  }
  resetSidebarWidth(): void { this.resizeSidebar(DEFAULT_SIDEBAR_WIDTH) }
  resetAgentWidth(): void { this.resizeAgent(DEFAULT_AGENT_WIDTH) }
  openDetails(): void { this.#update({ ...this.#snapshot, detailsOpen: true, agentOpen: true }) }
  closeDetails(): void { this.#update({ ...this.#snapshot, detailsOpen: false }) }
  dispose(): void { this.#listeners.clear() }

  #update(snapshot: ProjectLayoutSnapshot): void {
    if (snapshot.sidebarOpen === this.#snapshot.sidebarOpen
      && snapshot.sidebarWidth === this.#snapshot.sidebarWidth
      && snapshot.agentOpen === this.#snapshot.agentOpen
      && snapshot.agentWidth === this.#snapshot.agentWidth
      && snapshot.detailsOpen === this.#snapshot.detailsOpen) return
    this.#snapshot = Object.freeze(snapshot)
    for (const listener of this.#listeners) listener()
  }
}
