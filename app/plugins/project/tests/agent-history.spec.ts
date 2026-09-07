import { describe, expect, it } from 'vitest'
import { deriveAgentHistory } from '../src/client/agent-history.js'

function summary(id: string, updatedAt: number, overrides: Partial<{
  displayTitle: string
  blank: boolean
  running: boolean
  pendingInteraction: unknown
  completed: boolean
  origin: 'subagent'
}> = {}) {
  return {
    id,
    displayTitle: overrides.displayTitle ?? id,
    blank: overrides.blank ?? false,
    running: overrides.running ?? false,
    updatedAt,
    ...(overrides.pendingInteraction === undefined ? {} : { pendingInteraction: overrides.pendingInteraction }),
    ...(overrides.completed === undefined ? {} : { completed: overrides.completed }),
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
  }
}

describe('Agent project history', () => {
  it('shows only current-project top-level non-archived sessions by recency', () => {
    const rows = deriveAgentHistory({
      activeWorkspaceId: 'workspace-1',
      workspaces: [
        { workspaceId: 'workspace-1', sessionIds: ['older', 'newer', 'archived', 'child', 'blank-other', 'blank-current'] },
        { workspaceId: 'workspace-2', sessionIds: ['outside'] },
      ],
      archivedSessionIds: ['archived'],
      currentSessionId: 'blank-current',
      sessionsById: {
        older: summary('older', 10, { displayTitle: 'Older' }),
        newer: summary('newer', 30, { displayTitle: 'Newer', running: true }),
        archived: summary('archived', 40),
        child: summary('child', 50, { origin: 'subagent' }),
        'blank-other': summary('blank-other', 60, { blank: true }),
        'blank-current': summary('blank-current', 20, { blank: true, pendingInteraction: { kind: 'question' } }),
        outside: summary('outside', 70),
      },
    })

    expect(rows).toEqual([
      expect.objectContaining({ id: 'newer', title: 'Newer', running: true, selected: false }),
      expect.objectContaining({ id: 'blank-current', title: 'New session', pending: true, selected: true }),
      expect.objectContaining({ id: 'older', title: 'Older', completed: false }),
    ])
  })

  it('uses a deterministic id tie-break and handles incomplete baselines', () => {
    expect(deriveAgentHistory({ activeWorkspaceId: 'workspace-1', workspaces: [] })).toEqual([])
    expect(deriveAgentHistory({
      activeWorkspaceId: 'workspace-1',
      workspaces: [{ workspaceId: 'workspace-1', sessionIds: ['b', 'a'] }],
      sessionsById: { a: summary('a', 10), b: summary('b', 10, { completed: true }) },
    })).toEqual([
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b', completed: true }),
    ])
  })
})
