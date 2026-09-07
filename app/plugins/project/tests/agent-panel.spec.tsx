import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentHistoryPanel } from '../src/client/components.js'

const componentsSource = await readFile(new URL('../src/client/components.tsx', import.meta.url), 'utf8')

function store<T>(snapshot: T) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  }
}

const projectSnapshot = {
  activeWorkspaceId: 'workspace-1',
  workspaces: [{ workspaceId: 'workspace-1', title: 'Story', sessionIds: ['session-1'] }],
  sequence: 0,
  directories: {},
  expanded: [],
  phase: 'ready' as const,
}
const runtime = {
  getSnapshot: () => projectSnapshot,
  subscribe: () => () => undefined,
  newSession: vi.fn(async () => undefined),
}
const sessions = {
  list: store({
    ids: ['session-1'],
    current: 'session-1',
    byId: {
      'session-1': {
        id: 'session-1',
        displayTitle: 'Opening scene',
        blank: false,
        running: true,
        updatedAt: 10,
      },
    },
  }),
  open: vi.fn(),
}
const workspaces = {
  list: store({
    items: projectSnapshot.workspaces,
    archivedSessionIds: [],
    baselinesReady: true,
    recentWorkspaceId: 'workspace-1',
  }),
  connectWorkspace: vi.fn(),
  create: vi.fn(),
  pickDirectory: vi.fn(),
}

describe('Agent Chat App panel', () => {
  it('keeps the official conversation and details seats inside the BeUI shell', () => {
    expect(componentsSource).toContain('<ChatApp')
    expect(componentsSource).toContain("renderSlot('conversation', {})")
    expect(componentsSource).toContain("<SessionProvider>{renderSlot('details', {})}</SessionProvider>")
    expect(componentsSource).toContain("renderSlot('workbench.agent.header.action', { onNavigate: closeHistory })")
    expect(componentsSource).toContain('return mountBeuiConversationComposer(root)')
    expect(componentsSource).toContain('ref={conversationRef} className="cvxProjectConversation"')
    expect(componentsSource).toContain('aria-label={historyOpen ? \'Close conversation history\' : \'Open conversation history\'}')
    expect(componentsSource).toContain('aria-label="Collapse Agent panel"')
  })

  it('renders current-project history state without copying another store', () => {
    const markup = renderToStaticMarkup(
      <AgentHistoryPanel
        runtime={runtime as never}
        sessions={sessions}
        workspaces={workspaces}
        onSelect={() => undefined}
      />,
    )
    expect(markup).toContain('Recent conversations')
    expect(markup).toContain('Opening scene')
    expect(markup).toContain('aria-current="page"')
    expect(markup).toContain('data-state="running"')
  })
})
