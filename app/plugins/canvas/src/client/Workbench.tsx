import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  CanvasIcon,
  CanvasStyles,
  CanvasView,
  KindIcon,
  PlusIcon,
  kindLabel,
} from './CanvasView.tsx'
import {
  AGENT_MAX_WIDTH,
  AGENT_MIN_WIDTH,
  SIDEBAR_AUTO_COLLAPSE_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  WorkbenchLayout,
  solveWorkbenchColumns,
} from './layout.ts'
import { ComicCanvasWorkspace } from './comic-workspace-v2.js'
import type { CanvasProjectSync } from './project-sync-v2.js'

type RenderSlot = (name: string, owner: Record<string, unknown>) => ReactNode

function useWorkspace(workspace: ComicCanvasWorkspace) {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot)
}

interface ResizeHandleProps {
  readonly side: 'sidebar' | 'agent'
  readonly left: number
  readonly minimum: number
  readonly maximum: number
  readonly value: number
  readonly onResize: (value: number) => void
  readonly onDraggingChange: (dragging: boolean) => void
}

function ResizeHandle(props: ResizeHandleProps): ReactElement {
  const originRef = useRef(0)
  const valueRef = useRef(0)
  const latestRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const flush = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    const delta = props.side === 'sidebar'
      ? latestRef.current - originRef.current
      : originRef.current - latestRef.current
    props.onResize(valueRef.current + delta)
  }, [props])
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    originRef.current = event.clientX
    latestRef.current = event.clientX
    valueRef.current = props.value
    props.onDraggingChange(true)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latestRef.current = event.clientX
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(flush)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latestRef.current = event.clientX
    event.currentTarget.releasePointerCapture(event.pointerId)
    flush()
    props.onDraggingChange(false)
  }
  return (
    <div
      className="cvxWorkbenchResizeHandle"
      data-side={props.side}
      style={{ left: props.left }}
      role="separator"
      aria-label={props.side === 'sidebar' ? '调整项目侧栏宽度' : '调整 Agent 面板宽度'}
      aria-orientation="vertical"
      aria-valuemin={props.minimum}
      aria-valuemax={props.maximum}
      aria-valuenow={Math.round(props.value)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        const amount = event.key === 'ArrowRight' ? 24 : -24
        props.onResize(props.value + (props.side === 'sidebar' ? amount : -amount))
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

export interface CanvasWorkbenchProps {
  readonly workspace: ComicCanvasWorkspace
  readonly layout: WorkbenchLayout
  readonly renderSlot: RenderSlot
}

/** Product root: DSH sidebar slot, Canvas center, replaceable Agent panel slot. */
export function CanvasWorkbench({ workspace, layout, renderSlot }: CanvasWorkbenchProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const panels = useSyncExternalStore(layout.subscribe, layout.getSnapshot, layout.getSnapshot)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [dragging, setDragging] = useState(false)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        const width = root.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE_WIDTH
  useEffect(() => { layout.setNarrow(narrow) }, [layout, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : !panels.sidebarOpen
  const columns = solveWorkbenchColumns(
    viewport,
    sidebarCollapsed ? 0 : panels.sidebarWidth,
    panels.agentOpen ? panels.agentWidth : 0,
  )
  const style = {
    gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.agent}px`,
  } satisfies CSSProperties

  return (
    <div
      ref={rootRef}
      className="cvxWorkbench"
      style={style}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-agent-collapsed={columns.agent === 0 || undefined}
      data-resizing={dragging || undefined}
    >
      <CanvasStyles />
      <div className="cvxWorkbenchSidebar">
        {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: columns.sidebar })}
      </div>
      <main className="cvxWorkbenchCanvas"><CanvasView workspace={workspace} /></main>
      <div className="cvxWorkbenchAgentSeat">
        {renderSlot('workbench.agent', {
          collapsed: columns.agent === 0,
          detailsOpen: panels.detailsOpen,
          width: columns.agent,
        })}
      </div>
      <div className="cvxWorkbenchOverlays">{renderSlot('shell.overlay', {})}</div>
      {!sidebarCollapsed && (
        <ResizeHandle
          side="sidebar"
          left={columns.sidebar}
          minimum={SIDEBAR_MIN_WIDTH}
          maximum={SIDEBAR_MAX_WIDTH}
          value={panels.sidebarWidth}
          onResize={(width) => { layout.setSidebarWidth(width) }}
          onDraggingChange={setDragging}
        />
      )}
      {columns.agent > 0 && (
        <ResizeHandle
          side="agent"
          left={viewport - columns.agent}
          minimum={AGENT_MIN_WIDTH}
          maximum={AGENT_MAX_WIDTH}
          value={panels.agentWidth}
          onResize={(width) => { layout.setAgentWidth(width) }}
          onDraggingChange={setDragging}
        />
      )}
    </div>
  )
}

export interface CanvasProjectBrowserProps {
  readonly workspace: ComicCanvasWorkspace
  readonly project: CanvasProjectSync
  readonly wide: boolean
  readonly expandSidebar: () => void
}

/** Canvas-owned content contribution for the official sidebar.workspaces seat. */
export function CanvasProjectBrowser({ workspace, project, wide, expandSidebar }: CanvasProjectBrowserProps): ReactElement {
  const snapshot = useWorkspace(workspace)
  const projectSnapshot = useSyncExternalStore(project.subscribe, project.getSnapshot, project.getSnapshot)
  const [projectError, setProjectError] = useState<string>()
  const mediaNodes = snapshot.document.nodes.filter(node => node.kind === 'image')
  const visibleNodes = snapshot.document.nodes
  const runProjectAction = (action: () => Promise<unknown>): void => {
    setProjectError(undefined)
    void action().catch(error => { setProjectError(error instanceof Error ? error.message : String(error)) })
  }
  if (!wide) {
    return (
      <div className="cvxProjectRail">
        <button type="button" aria-label="展开漫画项目" title="漫画项目" onClick={expandSidebar}>
          <CanvasIcon size={18} />
        </button>
      </div>
    )
  }
  return (
    <nav className="cvxTreeScroll" aria-label="漫画项目">
      <section className="cvxTreeSection">
        <header><span>文件</span><small>{mediaNodes.length}</small></header>
        <div className="cvxTreeBranch"><span className="cvxTreeChevron">⌄</span><strong>assets</strong></div>
        {mediaNodes.length === 0
          ? <p className="cvxTreeEmpty">拖入图片后会显示在这里</p>
          : mediaNodes.map(node => (
              <button key={node.id} type="button" className="cvxTreeItem" onClick={() => { workspace.selectNode(node.id) }}>
                <KindIcon kind={node.kind} size={14} /><span>{node.title || node.id}</span>
              </button>
            ))}
      </section>
      <section className="cvxTreeSection">
        <header>
          <span>画布</span>
          <span className="cvxTreeHeaderActions">
            <small>{projectSnapshot.canvases.length}</small>
            <button
              type="button"
              className="cvxTreeAdd"
              aria-label="新建画布"
              title="新建画布"
              onClick={() => { runProjectAction(() => project.createCanvas()) }}
            ><PlusIcon size={13} /></button>
          </span>
        </header>
        {projectSnapshot.canvases.map(canvas => {
          const active = canvas.id === projectSnapshot.activeCanvasId
          return (
            <div key={canvas.id}>
              <button
                type="button"
                className={`cvxTreeItem${active ? ' cvxTreeItemActive' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => { runProjectAction(() => project.selectCanvas(canvas.id)) }}
              >
                <CanvasIcon size={14} /><span>{canvas.title}</span>
                <small>{canvas.nodeCount}</small>
              </button>
              {active && (
                <div className="cvxTreeNodes">
                  {visibleNodes.map(node => (
                    <button key={node.id} type="button" className="cvxTreeItem" onClick={() => { workspace.selectNode(node.id) }}>
                      <KindIcon kind={node.kind} size={13} /><span>{node.title || kindLabel(node.kind)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {projectError !== undefined && <p className="cvxTreeError" role="alert">{projectError}</p>}
      </section>
    </nav>
  )
}

export interface WorkbenchAgentPanelProps {
  readonly collapsed: boolean
  readonly detailsOpen: boolean
  readonly renderSlot: RenderSlot
}

/** Replaceable right panel shell; official conversation/details remain child slots. */
export function WorkbenchAgentPanel({ collapsed, detailsOpen, renderSlot }: WorkbenchAgentPanelProps): ReactElement {
  return (
    <aside className="cvxWorkbenchAgent" aria-label="Agent 对话" aria-hidden={collapsed || undefined}>
      <header>
        <div><span className="cvxAgentPulse" /><span>Agent</span></div>
        <div className="cvxWorkbenchAgentActions">{renderSlot('workbench.agent.header.action', {})}</div>
      </header>
      <div className="cvxWorkbenchAgentBody" data-details-open={detailsOpen || undefined}>
        <div className="cvxWorkbenchConversation" aria-hidden={detailsOpen || undefined}>
          {renderSlot('conversation', {})}
        </div>
        <div className="cvxWorkbenchDetails" aria-hidden={!detailsOpen || undefined}>
          {renderSlot('details', {})}
        </div>
      </div>
    </aside>
  )
}

export function NewSessionAction({ startSession }: { readonly startSession: () => void }): ReactElement {
  return (
    <button type="button" className="cvxAgentNewSession" onClick={startSession} title="新建对话">
      <PlusIcon size={14} /><span>新建对话</span>
    </button>
  )
}
