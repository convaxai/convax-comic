type Listener = () => void

export interface ProjectLayoutSnapshot {
  readonly sidebarOpen: boolean
  readonly agentOpen: boolean
  readonly detailsOpen: boolean
  readonly narrow: boolean
}

/** Official outward layout face plus the state used by the project shell. */
export class ProjectLayout {
  readonly #listeners = new Set<Listener>()
  #snapshot: ProjectLayoutSnapshot = Object.freeze({ sidebarOpen: true, agentOpen: true, detailsOpen: false, narrow: false })

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }
  readonly getSnapshot = (): ProjectLayoutSnapshot => this.#snapshot

  toggleSidebar(): void { this.#update({ ...this.#snapshot, sidebarOpen: !this.#snapshot.sidebarOpen }) }
  toggleAgent(): void { this.#update({ ...this.#snapshot, agentOpen: !this.#snapshot.agentOpen }) }
  openDetails(): void { this.#update({ ...this.#snapshot, detailsOpen: true, agentOpen: true }) }
  closeDetails(): void { this.#update({ ...this.#snapshot, detailsOpen: false }) }
  setNarrow(narrow: boolean): void { this.#update({ ...this.#snapshot, narrow }) }
  dispose(): void { this.#listeners.clear() }

  #update(snapshot: ProjectLayoutSnapshot): void {
    if (snapshot.sidebarOpen === this.#snapshot.sidebarOpen
      && snapshot.agentOpen === this.#snapshot.agentOpen
      && snapshot.detailsOpen === this.#snapshot.detailsOpen
      && snapshot.narrow === this.#snapshot.narrow) return
    this.#snapshot = Object.freeze(snapshot)
    for (const listener of this.#listeners) listener()
  }
}
