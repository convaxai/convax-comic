import { Button, BEUI_COMPONENT_CSS, BEUI_THEME_CSS, FileTree, FileTreeFile, FileTreeFolder } from '@convax/beui'
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ProjectFileEntry } from '../contracts.js'
import { ComicProjectRuntime } from './runtime.js'
import { ProjectLayout } from './layout.js'
import { ChevronRightIcon, PanelRightIcon, PlusIcon, ProjectEntryIcon } from './icons.js'
import css from './styles.css?inline'

type RenderSlot = (name: string, owner: Record<string, unknown>) => ReactNode

export function ProjectStyles(): ReactElement {
  return <><style>{BEUI_THEME_CSS}</style><style>{BEUI_COMPONENT_CSS}</style><style>{css}</style></>
}

export interface ProjectShellProps {
  readonly runtime: ComicProjectRuntime
  readonly layout: ProjectLayout
  readonly renderSlot: RenderSlot
}

export function ProjectShell({ runtime, layout, renderSlot }: ProjectShellProps): ReactElement {
  const state = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const style = {
    '--cvx-sidebar': state.sidebarOpen ? '300px' : '56px',
    '--cvx-agent': state.agentOpen ? '380px' : '0px',
  } as CSSProperties
  return (
    <div
      className="cvxProjectShell"
      data-sidebar-open={state.sidebarOpen || undefined}
      data-agent-open={state.agentOpen || undefined}
      style={style}
    >
      <ProjectStyles />
      <aside className="cvxProjectSidebar">{renderSlot('sidebar', { collapsed: !state.sidebarOpen, width: state.sidebarOpen ? 300 : 56 })}</aside>
      <main className="cvxProjectCenter">
        {renderSlot('workbench.center', { project: runtime })}
      </main>
      <div className="cvxProjectAgentSeat" data-collapsed={!state.agentOpen || undefined}>
        {renderSlot('workbench.agent', {
          collapsed: !state.agentOpen,
          detailsOpen: state.detailsOpen,
          width: state.agentOpen ? 380 : 0,
          toggleAgent: () => { layout.toggleAgent() },
        })}
      </div>
      {!state.agentOpen && (
        <button
          className="cvxProjectAgentReopen"
          type="button"
          aria-label="Expand Agent panel"
          title="Expand Agent panel"
          onClick={() => { layout.toggleAgent() }}
        ><PanelRightIcon open={false} size={17} /></button>
      )}
      <div className="cvxProjectOverlay">{renderSlot('shell.overlay', {})}</div>
    </div>
  )
}

function visibleFileCount(
  directories: Readonly<Record<string, { readonly entries: readonly ProjectFileEntry[] }>>,
  expanded: readonly string[],
): number {
  const open = new Set(expanded)
  const count = (parent: string): number => (directories[parent]?.entries ?? []).reduce((total, entry) => (
    total + 1 + (entry.kind === 'directory' && open.has(entry.path) ? count(entry.path) : 0)
  ), 0)
  return count('')
}

function fileTreeNodes(
  parent: string,
  directories: Readonly<Record<string, { readonly entries: readonly ProjectFileEntry[] }>>,
): ReactNode {
  return (directories[parent]?.entries ?? []).map(entry => {
    const icon = ({ open }: { readonly open: boolean }): ReactNode => (
      <ProjectEntryIcon entry={entry} expanded={open} />
    )
    if (entry.kind === 'directory') {
      return (
        <FileTreeFolder key={entry.path} value={entry.path} name={entry.name} icon={icon}>
          {fileTreeNodes(entry.path, directories)}
        </FileTreeFolder>
      )
    }
    return (
      <FileTreeFile
        key={entry.path}
        value={entry.path}
        name={entry.name}
        icon={icon}
        disabled={entry.kind === 'symlink'}
      />
    )
  })
}

export interface ProjectNavigatorProps {
  readonly runtime: ComicProjectRuntime
  readonly wide: boolean
  readonly expandSidebar: () => void
  readonly renderSlot: RenderSlot
}

export function ProjectNavigator({ runtime, wide, expandSidebar, renderSlot }: ProjectNavigatorProps): ReactElement {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const [actionError, setActionError] = useState<string>()
  const [filesExpanded, setFilesExpanded] = useState(true)

  useEffect(() => {
    const refresh = (): void => { void runtime.refreshVisibleDirectories() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [runtime])

  if (!wide) {
    return <button className="cvxProjectButton" type="button" title="Projects" onClick={expandSidebar}>▤</button>
  }
  const visibleFiles = visibleFileCount(snapshot.directories, snapshot.expanded)
  const run = (task: Promise<unknown>): void => {
    setActionError(undefined)
    void task.catch(error => { setActionError(error instanceof Error ? error.message : String(error)) })
  }
  const changeExpanded = (next: readonly string[]): void => {
    const current = new Set(snapshot.expanded)
    const target = new Set(next)
    const changed = [...new Set([...current, ...target])].filter(path => current.has(path) !== target.has(path))
    if (changed.length > 0) run(Promise.all(changed.map(path => runtime.toggleDirectory(path))))
  }

  return (
    <div className="cvxProjectNavigator">
      <ProjectStyles />
      <div className="cvxProjectSelector">
        <select
          aria-label="Active project"
          value={snapshot.activeWorkspaceId ?? ''}
          onChange={(event) => { if (event.target.value !== '') run(runtime.switchWorkspace(event.target.value)) }}
        >
          {snapshot.workspaces.length === 0 && <option value="">No projects</option>}
          {snapshot.workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
        </select>
        <Button className="cvxProjectButton" variant="ghost" size="icon" aria-label="Add project" title="Add project" onClick={() => { run(runtime.addProject()) }}><PlusIcon size={16} /></Button>
      </div>
      {actionError !== undefined && <div className="cvxProjectTreeStatus" role="alert">{actionError}</div>}
      <section className="cvxProjectFileSection" data-expanded={filesExpanded || undefined}>
        <button
          className="cvxProjectSectionHeader"
          type="button"
          aria-expanded={filesExpanded}
          onClick={() => { setFilesExpanded(expanded => !expanded) }}
        >
          <ChevronRightIcon className="cvxProjectSectionChevron" size={16} />
          <span>Files</span>
          <small>{visibleFiles}</small>
        </button>
        <div className="cvxProjectFiles" hidden={!filesExpanded}>
          {snapshot.phase === 'opening' && <div className="cvxProjectTreeStatus">Opening project…</div>}
          {snapshot.phase === 'error' && <div className="cvxProjectTreeStatus" role="alert">{snapshot.error}</div>}
          {snapshot.phase === 'ready' && visibleFiles === 0 && <div className="cvxProjectTreeStatus">This project is empty.</div>}
          <FileTree
            ariaLabel="Project files"
            expandedIds={snapshot.expanded}
            onExpandedChange={changeExpanded}
            className="cvxProjectFileTree"
          >
            {fileTreeNodes('', snapshot.directories)}
          </FileTree>
        </div>
      </section>
      <div className="cvxProjectChildren">{renderSlot('project.canvases', { project: runtime })}</div>
    </div>
  )
}

export interface WorkbenchAgentPanelProps {
  readonly collapsed: boolean
  readonly detailsOpen: boolean
  readonly toggleAgent: () => void
  readonly renderSlot: RenderSlot
}

export function WorkbenchAgentPanel({ collapsed, detailsOpen, toggleAgent, renderSlot }: WorkbenchAgentPanelProps): ReactElement {
  return (
    <aside className="cvxProjectAgent" aria-label="Agent" aria-hidden={collapsed || undefined}>
      <ProjectStyles />
      <header>
        <span>Agent</span>
        <span className="cvxProjectAgentActions">
          {renderSlot('workbench.agent.header.action', {})}
          <Button
            variant="ghost"
            size="icon"
            className="cvxProjectAgentToggle"
            aria-label="Collapse Agent panel"
            title="Collapse Agent panel"
            onClick={toggleAgent}
          ><PanelRightIcon open size={16} /></Button>
        </span>
      </header>
      <div className="cvxProjectAgentBody">
        <div className="cvxProjectConversation" hidden={detailsOpen}>{renderSlot('conversation', {})}</div>
        <div className="cvxProjectDetails" hidden={!detailsOpen}>{renderSlot('details', {})}</div>
      </div>
    </aside>
  )
}

export function NewSessionAction({ runtime }: { readonly runtime: ComicProjectRuntime }): ReactElement {
  return <Button variant="secondary" size="sm" className="cvxProjectAgentAction" onClick={() => { void runtime.newSession() }}>+ New session</Button>
}
