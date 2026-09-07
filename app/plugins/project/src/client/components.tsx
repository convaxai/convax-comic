import { AnimatedSidebar, AnimatedSidebarMenuItem, AnimatedSidebarSubmenu, Button, ChatApp, FileTree, FileTreeFile, FileTreeFolder, Select } from '@convax/beui'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentType,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import {
  PROJECT_FILE_DRAG_MIME,
  encodeProjectFileDragPayload,
  type ProjectFileEntry,
} from '../contracts.js'
import { deriveAgentHistory } from './agent-history.js'
import { mountBeuiConversationComposer } from './conversation-beui.js'
import { ProjectFileName } from './file-name.js'
import { ProjectFileHoverPreview, type ProjectFilePreviewAnchor } from './file-hover-preview.js'
import {
  ProjectFilePreviewController,
  type ProjectFilePreviewSnapshot,
} from './file-drag-preview.js'
import { ComicProjectRuntime, type SessionsLike, type WorkspacesLike } from './runtime.js'
import {
  DEFAULT_AGENT_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_AGENT_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_AGENT_WIDTH,
  MIN_CENTER_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  ProjectLayout,
  projectDetailsSessionTransition,
  projectPanelWidthFromPointer,
  resolveProjectPanelColumns,
} from './layout.js'
import { HistoryIcon, PanelRightIcon, PlusIcon, ProjectEntryIcon, ProjectsIcon } from './icons.js'
import css from './styles.css?inline'

type RenderSlot = (name: string, owner: Record<string, unknown>) => ReactNode
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ProjectStyles(): ReactElement {
  return <style>{css}</style>
}

export interface ProjectShellProps {
  readonly runtime: ComicProjectRuntime
  readonly layout: ProjectLayout
  readonly sessions: SessionsLike
  readonly renderSlot: RenderSlot
}

interface ProjectResizeHandleProps {
  readonly side: 'sidebar' | 'agent'
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onResize: (width: number) => void
  readonly onReset: () => void
  readonly onDraggingChange: (dragging: boolean) => void
}

function ProjectResizeHandle({ side, value, min, max, onResize, onReset, onDraggingChange }: ProjectResizeHandleProps): ReactElement {
  const drag = useRef<{ readonly pointerId: number; readonly startX: number; readonly startWidth: number } | null>(null)
  const frame = useRef<number | null>(null)
  const pendingWidth = useRef<number | null>(null)
  const direction = side === 'sidebar' ? 1 : -1
  const label = side === 'sidebar' ? 'Resize Project sidebar' : 'Resize Agent sidebar'
  const resize = (width: number): void => { onResize(Math.min(max, Math.max(min, width))) }
  const flushResize = (): void => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current)
    frame.current = null
    const width = pendingWidth.current
    pendingWidth.current = null
    if (width !== null) resize(width)
  }
  const scheduleResize = (width: number): void => {
    pendingWidth.current = width
    if (frame.current !== null) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null
      const next = pendingWidth.current
      pendingWidth.current = null
      if (next !== null) resize(next)
    })
  }
  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current)
  }, [])
  const endDrag = (element: HTMLDivElement, pointerId: number): void => {
    flushResize()
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    drag.current = null
    onDraggingChange(false)
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 32 : 12
    let next: number | undefined
    if (event.key === 'Home') next = min
    else if (event.key === 'End') next = max
    else if (event.key === 'ArrowLeft') next = value - direction * step
    else if (event.key === 'ArrowRight') next = value + direction * step
    if (next === undefined) return
    event.preventDefault()
    resize(next)
  }
  return (
    <div
      className="cvxProjectResizeHandle"
      data-side={side}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      title={`${label} · Double-click to reset`}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        event.preventDefault()
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: value }
        event.currentTarget.setPointerCapture(event.pointerId)
        onDraggingChange(true)
      }}
      onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
        const active = drag.current
        if (active === null || active.pointerId !== event.pointerId) return
        scheduleResize(projectPanelWidthFromPointer(side, active.startWidth, active.startX, event.clientX))
      }}
      onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => { endDrag(event.currentTarget, event.pointerId) }}
      onPointerCancel={(event: ReactPointerEvent<HTMLDivElement>) => { endDrag(event.currentTarget, event.pointerId) }}
      onLostPointerCapture={() => {
        if (drag.current === null) return
        flushResize()
        drag.current = null
        onDraggingChange(false)
      }}
    />
  )
}

function useObservedShellWidth(shellRef: { readonly current: HTMLDivElement | null }): number {
  const [shellWidth, setShellWidth] = useState(0)
  useEffect(() => {
    const shell = shellRef.current
    if (shell === null) return
    const update = (width: number): void => {
      if (!Number.isFinite(width) || width <= 0) return
      const next = Math.round(width)
      setShellWidth(current => current === next ? current : next)
    }
    update(shell.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find(candidate => candidate.target === shell)
      update(entry?.contentRect.width ?? shell.getBoundingClientRect().width)
    })
    observer.observe(shell)
    return () => { observer.disconnect() }
  }, [shellRef])
  return shellWidth
}

export interface ProjectShellViewProps extends Omit<ProjectShellProps, 'sessions'> {
  readonly shellWidth: number
  readonly shellRef?: Ref<HTMLDivElement>
}

/** Width-resolved shell view kept separate so concession behavior is component-testable. */
export function ProjectShellView({ runtime, layout, renderSlot, shellWidth, shellRef }: ProjectShellViewProps): ReactElement {
  const state = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const [resizing, setResizing] = useState<'sidebar' | 'agent'>()
  const columns = resolveProjectPanelColumns(state, shellWidth)
  const sidebarCollapsed = columns.sidebar === SIDEBAR_RAIL_WIDTH
  const agentCollapsed = columns.agent === 0
  const sidebarMax = shellWidth > 0
    ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, shellWidth - columns.agent - MIN_CENTER_WIDTH))
    : MAX_SIDEBAR_WIDTH
  const agentMax = shellWidth > 0
    ? Math.max(MIN_AGENT_WIDTH, Math.min(MAX_AGENT_WIDTH, shellWidth - columns.sidebar - MIN_CENTER_WIDTH))
    : MAX_AGENT_WIDTH
  const style = {
    '--cvx-sidebar': `${columns.sidebar}px`,
    '--cvx-agent': `${columns.agent}px`,
  } as CSSProperties
  const markDragging = (side: 'sidebar' | 'agent', dragging: boolean): void => {
    setResizing(current => dragging ? side : current === side ? undefined : current)
  }
  return (
    <div
      ref={shellRef}
      className="cvxProjectShell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-agent-collapsed={agentCollapsed || undefined}
      data-resizing={resizing}
      style={style}
    >
      <ProjectStyles />
      <AnimatedSidebar
        aria-label="Project sidebar"
        className="cvxProjectSidebar"
        collapsed={sidebarCollapsed}
        width={columns.sidebar}
      >
        {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: columns.sidebar })}
      </AnimatedSidebar>
      <main className="cvxProjectCenter">
        {renderSlot('workbench.center', { project: runtime })}
      </main>
      <div className="cvxProjectAgentSeat" data-collapsed={agentCollapsed || undefined}>
        {renderSlot('workbench.agent', {
          collapsed: agentCollapsed,
          detailsOpen: state.detailsOpen,
          width: columns.agent,
          toggleAgent: () => { layout.toggleAgent() },
        })}
      </div>
      {!sidebarCollapsed && (
        <ProjectResizeHandle
          side="sidebar"
          value={columns.sidebar}
          min={MIN_SIDEBAR_WIDTH}
          max={sidebarMax}
          onResize={(width) => { layout.resizeSidebar(width) }}
          onReset={() => { layout.resetSidebarWidth() }}
          onDraggingChange={(dragging) => { markDragging('sidebar', dragging) }}
        />
      )}
      {!agentCollapsed && (
        <ProjectResizeHandle
          side="agent"
          value={columns.agent}
          min={MIN_AGENT_WIDTH}
          max={agentMax}
          onResize={(width) => { layout.resizeAgent(width) }}
          onReset={() => { layout.resetAgentWidth() }}
          onDraggingChange={(dragging) => { markDragging('agent', dragging) }}
        />
      )}
      {!state.agentOpen && (
        <button
          className="cvxProjectAgentReopen"
          type="button"
          aria-label="Expand Agent panel"
          title="Expand Agent panel"
          onClick={() => { layout.toggleAgent() }}
        ><PanelRightIcon size={16} /></button>
      )}
      <div className="cvxProjectOverlay">{renderSlot('shell.overlay', {})}</div>
    </div>
  )
}

export function ProjectShell({ sessions, ...props }: ProjectShellProps): ReactElement {
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useObservedShellWidth(shellRef)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot, sessions.list.getSnapshot)
  const current = sessionList.current
  const detailsSession = current !== undefined && sessionList.byId?.[current]?.blank === false ? current : undefined
  const lastDetailsSession = useRef(detailsSession)
  useClientLayoutEffect(() => {
    const transition = projectDetailsSessionTransition(lastDetailsSession.current, detailsSession)
    lastDetailsSession.current = transition.lastSession
    if (transition.closeDetails) props.layout.closeDetails()
  }, [detailsSession, props.layout])
  return <ProjectShellView {...props} shellWidth={shellWidth} shellRef={shellRef} />
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

interface ProjectFilePreviewHandlers {
  readonly open: (entry: ProjectFileEntry, target: HTMLButtonElement, immediate: boolean) => void
  readonly close: (entry: ProjectFileEntry) => void
}

function loadedProjectMedia(
  directories: Readonly<Record<string, { readonly entries: readonly ProjectFileEntry[] }>>,
): ProjectFileEntry[] {
  return Object.values(directories).flatMap(directory => directory.entries.filter(entry => (
    entry.kind === 'file' && /\.(?:gif|jpe?g|m4v|mov|mp4|png|webm|webp)$/iu.test(entry.name)
  )))
}

function fileTreeNodes(
  parent: string,
  directories: Readonly<Record<string, { readonly entries: readonly ProjectFileEntry[] }>>,
  workspaceId: string,
  preview: ProjectFilePreviewController,
  previewSnapshot: ProjectFilePreviewSnapshot,
  previewHandlers: ProjectFilePreviewHandlers,
): ReactNode {
  return (directories[parent]?.entries ?? []).map(entry => {
    if (entry.kind === 'directory') {
      return (
        <FileTreeFolder key={entry.path} value={entry.path} name={entry.name}>
          {fileTreeNodes(entry.path, directories, workspaceId, preview, previewSnapshot, previewHandlers)}
        </FileTreeFolder>
      )
    }
    return (
      <FileTreeFile
        key={entry.path}
        value={entry.path}
        name={entry.name}
        label={<ProjectFileName name={entry.name} />}
        icon={<ProjectEntryIcon entry={entry} expanded={false} previewUrl={previewSnapshot.thumbnails[entry.path]} />}
        disabled={entry.kind === 'symlink'}
        draggable={entry.kind === 'file'}
        onPointerEnter={event => { previewHandlers.open(entry, event.currentTarget, false) }}
        onPointerLeave={() => { previewHandlers.close(entry) }}
        onFocus={event => { previewHandlers.open(entry, event.currentTarget, true) }}
        onBlur={() => { previewHandlers.close(entry) }}
        onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
          event.dataTransfer.clearData()
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(PROJECT_FILE_DRAG_MIME, encodeProjectFileDragPayload({
            workspaceId,
            path: entry.path,
          }))
          preview.setDragImage(event.dataTransfer, entry)
        }}
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
  const preview = useMemo(() => new ProjectFilePreviewController(() => runtime.scope()), [runtime])
  const previewSnapshot = useSyncExternalStore(preview.subscribe, preview.getSnapshot, preview.getSnapshot)
  const previewTimer = useRef<number | null>(null)
  const [previewAnchor, setPreviewAnchor] = useState<ProjectFilePreviewAnchor>()
  const [actionError, setActionError] = useState<string>()
  const [filesExpanded, setFilesExpanded] = useState(true)

  useEffect(() => () => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    preview.dispose()
  }, [preview])
  useEffect(() => {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
    previewTimer.current = null
    setPreviewAnchor(undefined)
    preview.reset()
  }, [preview, snapshot.activeWorkspaceId, snapshot.sequence])
  useEffect(() => {
    if (wide) preview.preloadMedia(loadedProjectMedia(snapshot.directories))
  }, [preview, snapshot.directories, snapshot.sequence, wide])
  useEffect(() => {
    const refresh = (): void => { void runtime.refreshVisibleDirectories() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [runtime])

  const previewHandlers: ProjectFilePreviewHandlers = {
    open(entry, target, immediate) {
      if (entry.kind !== 'file') return
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
      preview.prime(entry)
      const show = (): void => {
        previewTimer.current = null
        if (!target.isConnected) return
        const rect = target.getBoundingClientRect()
        setPreviewAnchor({ path: entry.path, top: rect.top, left: rect.left, right: rect.right })
        preview.open(entry)
      }
      if (immediate) show()
      else previewTimer.current = window.setTimeout(show, 180)
    },
    close(entry) {
      if (previewTimer.current !== null) window.clearTimeout(previewTimer.current)
      previewTimer.current = null
      setPreviewAnchor(current => current?.path === entry.path ? undefined : current)
      preview.close(entry.path)
    },
  }

  if (!wide) {
    return (
      <Button
        className="cvxProjectButton cvxProjectRailButton"
        variant="ghost"
        size="icon"
        type="button"
        aria-label="Expand projects"
        title="Projects"
        onClick={expandSidebar}
      ><ProjectsIcon size={18} /></Button>
    )
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
        <Select
          className="cvxProjectWorkspaceSelect"
          ariaLabel="Active project"
          value={snapshot.activeWorkspaceId}
          options={snapshot.workspaces.map(workspace => ({ value: workspace.workspaceId, label: workspace.title }))}
          placeholder="No projects"
          disabled={snapshot.workspaces.length === 0}
          onValueChange={(workspaceId) => { run(runtime.switchWorkspace(workspaceId)) }}
        />
        <Button className="cvxProjectButton" variant="ghost" size="icon" aria-label="Add project" title="Add project" onClick={() => { run(runtime.addProject()) }}><PlusIcon size={16} /></Button>
      </div>
      {actionError !== undefined && <div className="cvxProjectTreeStatus" role="alert">{actionError}</div>}
      <section className="cvxProjectFileSection" data-expanded={filesExpanded || undefined}>
        <AnimatedSidebarMenuItem
          className="cvxProjectSectionItem"
          variant="section"
          label="Files"
          meta={visibleFiles}
          expanded={filesExpanded}
          onToggle={() => { setFilesExpanded(expanded => !expanded) }}
        />
        <AnimatedSidebarSubmenu expanded={filesExpanded} className="cvxProjectFilesMotion">
          <div className="cvxProjectFiles">
            {snapshot.phase === 'opening' && <div className="cvxProjectTreeStatus">Opening project…</div>}
            {snapshot.phase === 'error' && <div className="cvxProjectTreeStatus" role="alert">{snapshot.error}</div>}
            {snapshot.phase === 'ready' && visibleFiles === 0 && <div className="cvxProjectTreeStatus">This project is empty.</div>}
            <FileTree
              ariaLabel="Project files"
              expandedIds={snapshot.expanded}
              onExpandedChange={changeExpanded}
              className="cvxProjectFileTree"
            >
              {snapshot.activeWorkspaceId !== undefined && fileTreeNodes(
                '', snapshot.directories, snapshot.activeWorkspaceId, preview, previewSnapshot, previewHandlers,
              )}
            </FileTree>
          </div>
        </AnimatedSidebarSubmenu>
      </section>
      <div className="cvxProjectChildren">{renderSlot('project.canvases', { project: runtime })}</div>
      <ProjectFileHoverPreview snapshot={previewSnapshot} anchor={previewAnchor} />
    </div>
  )
}

export interface WorkbenchAgentPanelProps {
  readonly SessionProvider: ComponentType<{ readonly children?: ReactNode }>
  readonly collapsed: boolean
  readonly detailsOpen: boolean
  readonly toggleAgent: () => void
  readonly renderSlot: RenderSlot
  readonly runtime: ComicProjectRuntime
  readonly sessions: SessionsLike
  readonly workspaces: WorkspacesLike
}

interface AgentHistoryPanelProps {
  readonly runtime: ComicProjectRuntime
  readonly sessions: SessionsLike
  readonly workspaces: WorkspacesLike
  readonly onSelect: () => void
}

export function AgentHistoryPanel({ runtime, sessions, workspaces, onSelect }: AgentHistoryPanelProps): ReactElement {
  const project = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot, sessions.list.getSnapshot)
  const workspaceList = useSyncExternalStore(workspaces.list.subscribe, workspaces.list.getSnapshot, workspaces.list.getSnapshot)
  const rows = deriveAgentHistory({
    workspaces: workspaceList.items,
    ...(project.activeWorkspaceId === undefined ? {} : { activeWorkspaceId: project.activeWorkspaceId }),
    ...(workspaceList.archivedSessionIds === undefined ? {} : { archivedSessionIds: workspaceList.archivedSessionIds }),
    ...(sessionList.current === undefined ? {} : { currentSessionId: sessionList.current }),
    ...(sessionList.byId === undefined ? {} : { sessionsById: sessionList.byId }),
  })
  const select = (sessionId: string): void => {
    sessions.open(sessionId)
    onSelect()
  }
  return (
    <div className="cvxProjectAgentHistory">
      <div className="cvxProjectAgentHistoryHeading">
        <span>Recent conversations</span>
        <small>{rows.length}</small>
      </div>
      <div className="cvxProjectAgentHistoryList" role="list">
        {!workspaceList.baselinesReady && <div className="cvxProjectAgentHistoryEmpty">Loading conversations…</div>}
        {workspaceList.baselinesReady && project.activeWorkspaceId === undefined && (
          <div className="cvxProjectAgentHistoryEmpty">Select a project to view its conversations.</div>
        )}
        {workspaceList.baselinesReady && project.activeWorkspaceId !== undefined && rows.length === 0 && (
          <div className="cvxProjectAgentHistoryEmpty">No conversations in this project yet.</div>
        )}
        {rows.map(row => {
          const state = row.pending ? 'pending' : row.running ? 'running' : row.completed ? 'completed' : 'idle'
          const stateLabel = row.pending ? 'Needs input' : row.running ? 'Running' : row.completed ? 'Completed' : undefined
          return (
            <div key={row.id} role="listitem" className="cvxProjectAgentHistoryItem">
              <button
                type="button"
                className="cvxProjectAgentHistoryRow"
                aria-current={row.selected ? 'page' : undefined}
                onClick={() => { select(row.id) }}
              >
                <span className="cvxProjectAgentHistoryStatus" data-state={state} aria-hidden="true" />
                <span className="cvxProjectAgentHistoryTitle">{row.title}</span>
                {stateLabel !== undefined && <small className="cvxProjectAgentHistoryMeta">{stateLabel}</small>}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function WorkbenchAgentPanel({
  SessionProvider,
  collapsed,
  detailsOpen,
  toggleAgent,
  renderSlot,
  runtime,
  sessions,
  workspaces,
}: WorkbenchAgentPanelProps): ReactElement {
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyTriggerRef = useRef<HTMLButtonElement>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = conversationRef.current
    if (root === null) return
    return mountBeuiConversationComposer(root)
  }, [])
  useEffect(() => {
    if (detailsOpen) setHistoryOpen(false)
  }, [detailsOpen])
  const closeHistory = (): void => { setHistoryOpen(false) }
  return (
    <aside className="cvxProjectAgent" aria-label="Agent" aria-hidden={collapsed || undefined}>
      <ProjectStyles />
      <header>
        <span className="cvxProjectAgentTitle">{historyOpen && !detailsOpen ? 'History' : 'Agent'}</span>
        <span className="cvxProjectAgentActions">
          {renderSlot('workbench.agent.header.action', { onNavigate: closeHistory })}
          <Button
            ref={historyTriggerRef}
            variant="ghost"
            size="icon"
            className="cvxProjectAgentToggle cvxProjectAgentHistoryToggle"
            aria-label={historyOpen ? 'Close conversation history' : 'Open conversation history'}
            aria-pressed={historyOpen}
            title={historyOpen ? 'Close conversation history' : 'Conversation history'}
            disabled={detailsOpen}
            onClick={() => { setHistoryOpen(open => !open) }}
          ><HistoryIcon size={16} /></Button>
          <Button
            variant="ghost"
            size="icon"
            className="cvxProjectAgentToggle"
            aria-label="Collapse Agent panel"
            title="Collapse Agent panel"
            onClick={toggleAgent}
          ><PanelRightIcon size={16} /></Button>
        </span>
      </header>
      <div className="cvxProjectAgentBody">
        <ChatApp
          navigationOpen={historyOpen && !detailsOpen}
          navigationLabel="Conversation history"
          navigationTriggerRef={historyTriggerRef}
          onNavigationOpenChange={setHistoryOpen}
          navigation={<AgentHistoryPanel runtime={runtime} sessions={sessions} workspaces={workspaces} onSelect={closeHistory} />}
        >
          <div ref={conversationRef} className="cvxProjectConversation" hidden={detailsOpen}>{renderSlot('conversation', {})}</div>
          <div className="cvxProjectDetails" hidden={!detailsOpen}><SessionProvider>{renderSlot('details', {})}</SessionProvider></div>
        </ChatApp>
      </div>
    </aside>
  )
}

export function NewSessionAction({
  runtime,
  onNavigate,
}: {
  readonly runtime: ComicProjectRuntime
  readonly onNavigate?: () => void
}): ReactElement {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="cvxProjectAgentAction"
      onClick={() => { void runtime.newSession().then(() => { onNavigate?.() }) }}
    >+ New session</Button>
  )
}
