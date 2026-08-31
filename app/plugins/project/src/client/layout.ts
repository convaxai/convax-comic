type Listener = () => void

export const DEFAULT_SIDEBAR_WIDTH = 300
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 520
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
  readonly narrow: boolean
}

function clampWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export interface ProjectPanelColumns {
  readonly sidebar: number
  readonly agent: number
}

/**
 * Resolve rendered columns from preferred widths. Panels yield proportionally
 * down to their minima when the window narrows and recover automatically when
 * space returns; collapse geometry remains the fixed 56/0 contract.
 */
export function resolveProjectPanelColumns(
  state: Pick<ProjectLayoutSnapshot, 'sidebarOpen' | 'sidebarWidth' | 'agentOpen' | 'agentWidth'>,
  shellWidth: number,
): ProjectPanelColumns {
  const preferredSidebar = state.sidebarOpen ? clampWidth(state.sidebarWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH) : 56
  const preferredAgent = state.agentOpen ? clampWidth(state.agentWidth, MIN_AGENT_WIDTH, MAX_AGENT_WIDTH) : 0
  if (!Number.isFinite(shellWidth) || shellWidth <= 0) return { sidebar: preferredSidebar, agent: preferredAgent }

  const minimumSidebar = state.sidebarOpen ? MIN_SIDEBAR_WIDTH : 56
  const minimumAgent = state.agentOpen ? MIN_AGENT_WIDTH : 0
  const panelBudget = Math.max(0, Math.round(shellWidth) - MIN_CENTER_WIDTH)
  const minimumTotal = minimumSidebar + minimumAgent
  if (panelBudget <= minimumTotal) return { sidebar: minimumSidebar, agent: minimumAgent }

  const preferredTotal = preferredSidebar + preferredAgent
  if (preferredTotal <= panelBudget) return { sidebar: preferredSidebar, agent: preferredAgent }

  const overflow = preferredTotal - panelBudget
  const sidebarCapacity = preferredSidebar - minimumSidebar
  const agentCapacity = preferredAgent - minimumAgent
  const totalCapacity = sidebarCapacity + agentCapacity
  if (totalCapacity <= 0) return { sidebar: preferredSidebar, agent: preferredAgent }

  let sidebarReduction = Math.min(sidebarCapacity, Math.round(overflow * sidebarCapacity / totalCapacity))
  let agentReduction = overflow - sidebarReduction
  if (agentReduction > agentCapacity) {
    sidebarReduction += agentReduction - agentCapacity
    agentReduction = agentCapacity
  }
  return {
    sidebar: preferredSidebar - sidebarReduction,
    agent: preferredAgent - agentReduction,
  }
}

/** Official outward layout face plus the state used by the project shell. */
export class ProjectLayout {
  readonly #listeners = new Set<Listener>()
  #snapshot: ProjectLayoutSnapshot = Object.freeze({
    sidebarOpen: true,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    agentOpen: true,
    agentWidth: DEFAULT_AGENT_WIDTH,
    detailsOpen: false,
    narrow: false,
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
  setNarrow(narrow: boolean): void { this.#update({ ...this.#snapshot, narrow }) }
  dispose(): void { this.#listeners.clear() }

  #update(snapshot: ProjectLayoutSnapshot): void {
    if (snapshot.sidebarOpen === this.#snapshot.sidebarOpen
      && snapshot.sidebarWidth === this.#snapshot.sidebarWidth
      && snapshot.agentOpen === this.#snapshot.agentOpen
      && snapshot.agentWidth === this.#snapshot.agentWidth
      && snapshot.detailsOpen === this.#snapshot.detailsOpen
      && snapshot.narrow === this.#snapshot.narrow) return
    this.#snapshot = Object.freeze(snapshot)
    for (const listener of this.#listeners) listener()
  }
}
