export interface AgentHistorySessionSummary {
  readonly id: string
  readonly displayTitle: string
  readonly blank: boolean
  readonly running: boolean
  readonly pendingInteraction?: unknown
  readonly completed?: boolean
  readonly updatedAt: number
  readonly origin?: 'subagent'
}

export interface AgentHistoryWorkspace {
  readonly workspaceId: string
  readonly sessionIds: readonly string[]
}

export interface AgentHistoryInput {
  readonly activeWorkspaceId?: string
  readonly workspaces: readonly AgentHistoryWorkspace[]
  readonly archivedSessionIds?: readonly string[]
  readonly currentSessionId?: string
  readonly sessionsById?: Readonly<Record<string, AgentHistorySessionSummary>>
}

export interface AgentHistoryRow {
  readonly id: string
  readonly title: string
  readonly selected: boolean
  readonly running: boolean
  readonly pending: boolean
  readonly completed: boolean
  readonly updatedAt: number
}

/**
 * Project-local history follows DSH Workspace accounting instead of copying it.
 * Visibility matches the official browser: archived and subagent sessions stay
 * out, and only the selected provisional blank session is shown.
 */
export function deriveAgentHistory(input: AgentHistoryInput): AgentHistoryRow[] {
  const workspace = input.workspaces.find(item => item.workspaceId === input.activeWorkspaceId)
  if (workspace === undefined || input.sessionsById === undefined) return []
  const archived = new Set(input.archivedSessionIds ?? [])
  const rows: AgentHistoryRow[] = []
  for (const id of workspace.sessionIds) {
    const session = input.sessionsById[id]
    if (session === undefined
      || session.origin === 'subagent'
      || archived.has(id)
      || (session.blank && id !== input.currentSessionId)) continue
    rows.push(Object.freeze({
      id,
      title: session.blank ? 'New session' : session.displayTitle,
      selected: id === input.currentSessionId,
      running: session.running,
      pending: session.pendingInteraction !== undefined,
      completed: session.completed === true,
      updatedAt: session.updatedAt,
    }))
  }
  rows.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  return rows
}
