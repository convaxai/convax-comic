import { Button, FileTree, FileTreeFile, FileTreeFolder, Select } from '@convax/beui'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
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
import { ComicProjectRuntime } from './runtime.js'
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
  projectPanelWidthFromPointer,
  resolveProjectPanelColumns,
} from './layout.js'
import { ChevronRightIcon, PanelRightIcon, PlusIcon, ProjectEntryIcon } from './icons.js'
import css from './styles.css?inline'

type RenderSlot = (name: string, owner: Record<string, unknown>) => ReactNode

export function ProjectStyles(): ReactElement {
  return <style>{css}</style>
}

export interface ProjectShellProps {
  readonly runtime: ComicProjectRuntime
  readonly layout: ProjectLayout
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

export interface ProjectShellViewProps extends ProjectShellProps {
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
      <aside className="cvxProjectSidebar">{renderSlot('sidebar', { collapsed: sidebarCollapsed, width: columns.sidebar })}</aside>
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

export function ProjectShell(props: ProjectShellProps): ReactElement {
  const shellRef = useRef<HTMLDivElement>(null)
  const shellWidth = useObservedShellWidth(shellRef)
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

function fileTreeNodes(
  parent: string,
  directories: Readonly<Record<string, { readonly entries: readonly ProjectFileEntry[] }>>,
  workspaceId: string,
): ReactNode {
  return (directories[parent]?.entries ?? []).map(entry => {
    const icon = ({ open }: { readonly open: boolean }): ReactNode => (
      <ProjectEntryIcon entry={entry} expanded={open} />
    )
    if (entry.kind === 'directory') {
      return (
        <FileTreeFolder key={entry.path} value={entry.path} name={entry.name} icon={icon}>
          {fileTreeNodes(entry.path, directories, workspaceId)}
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
        draggable={entry.kind === 'file'}
        onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
          event.dataTransfer.clearData()
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(PROJECT_FILE_DRAG_MIME, encodeProjectFileDragPayload({
            workspaceId,
            path: entry.path,
          }))
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
            {snapshot.activeWorkspaceId !== undefined && fileTreeNodes('', snapshot.directories, snapshot.activeWorkspaceId)}
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
          ><PanelRightIcon size={16} /></Button>
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
