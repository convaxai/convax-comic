import {
  Background,
  BackgroundVariant,
  BaseEdge,
  getBezierPath,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import {
  BEUI_COMPONENT_CSS,
  BEUI_THEME_CSS,
  Button,
} from '@convax/beui'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactElement,
  type ReactNode,
  type SVGProps,
} from 'react'
import {
  CANVAS_DROP_MIME,
  parseCanvasDropPayload,
  type ComicCanvasDropPayload,
  type ComicCanvasNode,
  type ComicCanvasPoint,
} from './comic-ui-contract.js'
import {
  ComicCanvasWorkspace,
  type ComicCanvasNodeProjection,
  type ComicCanvasWorkspaceSnapshot,
} from './comic-workspace-v2.js'
import {
  applyCanvasSelectionChanges,
  CANVAS_NODE_POINTER_POLICY,
  resolveCanvasInteractionPolicy,
  resolveCanvasShortcut,
  tidyCanvasNodes,
  type CanvasLayoutDirection,
  type CanvasShortcutCommand,
} from './interaction.ts'
import flowCss from '@xyflow/react/dist/style.css?inline'
import canvasCss from './canvas.css?inline'

type IconProps = SVGProps<SVGSVGElement> & { readonly size?: number }

function Icon({ size = 17, children, ...props }: IconProps & { readonly children: ReactNode }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export function CanvasIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 4v16" /></Icon>
}

export function ChevronRightIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon>
}

function NoteIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M6 3h9l3 3v15H6z" /><path d="M15 3v4h4M9 11h6M9 15h6" /></Icon>
}

function ImageIcon(props: IconProps): ReactElement {
  return <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 5" /></Icon>
}

function DuplicateIcon(props: IconProps): ReactElement {
  return <Icon {...props}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></Icon>
}

function TrashIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></Icon>
}

function SparklesIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25z" /><path d="m18 14 .75 2.25L21 17l-2.25.75L18 20l-.75-2.25L15 17l2.25-.75z" /><path d="m5 13 .65 1.85L7.5 15.5l-1.85.65L5 18l-.65-1.85-1.85-.65 1.85-.65z" /></Icon>
}

function DownloadIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M5 15v5h14v-5" /></Icon>
}

function FocusIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><circle cx="12" cy="12" r="3" /></Icon>
}

function ZoomOutIcon(props: IconProps): ReactElement {
  return <Icon {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M6 10.5h9M15.5 15.5 21 21" /></Icon>
}

function ZoomInIcon(props: IconProps): ReactElement {
  return <Icon {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="M6 10.5h9M10.5 6v9M15.5 15.5 21 21" /></Icon>
}

function MapIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15" /></Icon>
}

function ChevronUpIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m7 14 5-5 5 5" /></Icon>
}

function CheckIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>
}

function EdgeVisibilityIcon({ hidden, ...props }: IconProps & { readonly hidden: boolean }): ReactElement {
  return <Icon {...props}><circle cx="5" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 12h10" />{hidden && <path d="m4 4 16 16" />}</Icon>
}

function LayoutIcon(props: IconProps): ReactElement {
  return <Icon {...props}><rect x="3" y="4" width="7" height="6" rx="1" /><rect x="14" y="4" width="7" height="6" rx="1" /><rect x="3" y="14" width="7" height="6" rx="1" /><rect x="14" y="14" width="7" height="6" rx="1" /></Icon>
}

function MagnetIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4" /></Icon>
}

function CloseIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>
}

export function PlusIcon(props: IconProps): ReactElement {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
}

export function CanvasStyles(): ReactElement {
  return (
    <style data-convax-canvas-style>
      {flowCss}{'\n'}{BEUI_THEME_CSS}{'\n'}{BEUI_COMPONENT_CSS}{'\n'}{canvasCss}
    </style>
  )
}

function useWorkspaceSnapshot(workspace: ComicCanvasWorkspace): ComicCanvasWorkspaceSnapshot {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot)
}

export interface CanvasLauncherProps {
  readonly workspace: ComicCanvasWorkspace
  /** The sidebar passes false while rendering its compact rail. */
  readonly wide?: boolean
}

/** Sidebar affordance. The overlay itself is rendered by the root shell slot. */
export function CanvasLauncher({ workspace, wide = true }: CanvasLauncherProps): ReactElement {
  const snapshot = useWorkspaceSnapshot(workspace)
  return (
    <div className="cvxCanvasLauncher">
      <CanvasStyles />
      <button
        type="button"
        className="cvxCanvasLauncherButton"
        aria-label="打开画布"
        aria-pressed={snapshot.open}
        title="打开画布"
        onClick={() => { workspace.openCanvas() }}
      >
        <CanvasIcon size={18} />
        {wide && <span className="cvxCanvasLauncherLabel">画布</span>}
      </button>
    </div>
  )
}

type CanvasFlowData = {
  readonly domain: ComicCanvasNodeProjection
  readonly previewUrl?: string
  readonly resizeVisible: boolean
  readonly entering: boolean
  readonly finishEntry: (nodeId: string) => void
} & Record<string, unknown>

type CanvasFlowNode = Node<CanvasFlowData, 'canvas'>
type CanvasFlowEdge = Edge<{ readonly domainId: string }, 'canvas'>

const WorkspaceContext = createContext<ComicCanvasWorkspace | null>(null)

function useComicCanvasWorkspace(): ComicCanvasWorkspace {
  const workspace = useContext(WorkspaceContext)
  if (workspace === null) throw new Error('Canvas node rendered without a ComicCanvasWorkspace')
  return workspace
}

export function kindLabel(kind: ComicCanvasNode['kind']): string {
  if (kind === 'note') return '文本'
  if (kind === 'image') return '图片'
  return '旧视频'
}

export function KindIcon({ kind, size = 15 }: { readonly kind: ComicCanvasNode['kind']; readonly size?: number }): ReactElement {
  if (kind === 'note') return <NoteIcon size={size} />
  return <ImageIcon size={size} />
}

const CanvasNodeCard = memo(function CanvasNodeCard({ id, data, selected }: NodeProps<CanvasFlowNode>): ReactElement {
  const workspace = useComicCanvasWorkspace()
  useSyncExternalStore(workspace.renderers.subscribe, workspace.renderers.getSnapshot, workspace.renderers.getSnapshot)
  const node = data.domain
  const unknown = 'readOnlyData' in node && node.readOnlyData === true
  const v2Node = workspace.getV2Node(id)
  const NodeRenderer = v2Node === undefined
    ? undefined
    : workspace.renderers.resolveNode(v2Node.type, v2Node.kindVersion)
  const pluginActions = v2Node === undefined ? undefined : {
    update: (changes: Parameters<ComicCanvasWorkspace['updateV2Node']>[1]) => workspace.updateV2Node(id, changes),
    remove: () => workspace.removeV2Node(id),
    select: (next = true) => {
      const current = workspace.getSnapshot().selection
      workspace.setSelection({
        nodeIds: next ? [...new Set([...current.nodeIds, id])] : current.nodeIds.filter(nodeId => nodeId !== id),
        edgeIds: current.edgeIds,
      })
    },
    focus: () => { workspace.selectNode(id) },
  }
  // React Flow tears down the active resize gesture when these callback
  // identities change. Keep them stable while controlled geometry updates
  // re-render the node so onResizeEnd can close the undo transaction.
  const beginResize = useCallback(() => { workspace.beginGesture() }, [workspace])
  const resize = useCallback((_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
    workspace.updateNode(id, {
      position: { x: params.x, y: params.y },
      size: { width: params.width, height: params.height },
    })
  }, [id, workspace])
  const endResize = useCallback(() => { workspace.endGesture() }, [workspace])
  return (
    <>
      <NodeResizer
        color="var(--cvx-canvas-accent)"
        handleClassName="cvxCanvasNodeResizerHandle"
        isVisible={selected && data.resizeVisible === true}
        keepAspectRatio={node.kind === 'image'}
        lineClassName="cvxCanvasNodeResizerLine"
        {...(node.kind === 'image' ? { lineStyle: { display: 'none' } } : {})}
        minWidth={160}
        minHeight={96}
        onResizeStart={beginResize}
        onResize={resize}
        onResizeEnd={endResize}
      />
      <div
        className="cvxCanvasNode"
        data-entering={data.entering || undefined}
        data-kind={unknown ? 'unknown' : node.kind}
        data-selected={selected || undefined}
      >
        <div
          className="cvxCanvasNodeEntryShell"
          onAnimationEnd={(event) => {
            if (event.currentTarget === event.target && event.animationName === 'cvx-canvas-node-enter') {
              data.finishEntry(id)
            }
          }}
        >
          <div className="cvxCanvasNodeHeader" data-canvas-node-drag-handle="true">
            <span className="cvxCanvasNodeKind"><KindIcon kind={node.kind} /></span>
            <span className="cvxCanvasNodeTitle">{node.title || kindLabel(node.kind)}</span>
          </div>
          <div className="cvxCanvasNodeSurface" data-kind={unknown ? 'unknown' : node.kind}>
            {node.kind === 'image' && data.previewUrl !== undefined ? (
              <div className="cvxCanvasNodeBody cvxCanvasMediaBody" data-canvas-temporary-preview>
                <img src={data.previewUrl} alt={node.alt || node.title} draggable={false} />
              </div>
            ) : NodeRenderer !== undefined && v2Node !== undefined && pluginActions !== undefined ? (
              <div className={`cvxCanvasNodeBody${node.kind === 'note' ? ' cvxCanvasNoteBody' : ''}`} data-canvas-plugin-node={v2Node.type}>
                <NodeRenderer
                  sessionId={workspace.sessionId}
                  node={v2Node}
                  selected={selected}
                  actions={pluginActions}
                />
              </div>
            ) : null}
          </div>
        </div>
        <Handle className="cvxCanvasHandle cvxCanvasHandleInput" type="target" position={Position.Left}><PlusIcon size={14} /></Handle>
        <Handle className="cvxCanvasHandle cvxCanvasHandleOutput" type="source" position={Position.Right}><PlusIcon size={14} /></Handle>
      </div>
    </>
  )
})

const CanvasEdgeLine = memo(function CanvasEdgeLine({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps<CanvasFlowEdge>): ReactElement {
  const workspace = useComicCanvasWorkspace()
  useSyncExternalStore(workspace.renderers.subscribe, workspace.renderers.getSnapshot, workspace.renderers.getSnapshot)
  const edge = workspace.getV2Edge(data?.domainId ?? id)
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  if (edge === undefined) return (
    <BaseEdge
      id={id}
      path={path}
      {...(markerEnd === undefined ? {} : { markerEnd })}
      {...(style === undefined ? {} : { style })}
    />
  )
  const Renderer = workspace.renderers.resolveEdge(edge.type, edge.kindVersion)
  const actions = {
    update: (changes: Parameters<ComicCanvasWorkspace['updateV2Edge']>[1]) => workspace.updateV2Edge(id, changes),
    remove: () => workspace.removeV2Edge(id),
    select: (next = true) => {
      const current = workspace.getSnapshot().selection
      workspace.setSelection({
        nodeIds: current.nodeIds,
        edgeIds: next ? [...new Set([...current.edgeIds, id])] : current.edgeIds.filter(edgeId => edgeId !== id),
      })
    },
    focus: () => { workspace.setSelection({ nodeIds: [], edgeIds: [id] }) },
  }
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        {...(style === undefined ? {} : { style })}
      />
      <g transform={`translate(${String(labelX)} ${String(labelY)})`} data-canvas-edge-selected={selected === true || undefined}>
        <Renderer sessionId={workspace.sessionId} edge={edge} selected={selected === true} actions={actions} />
      </g>
    </>
  )
})

const NODE_TYPES = { canvas: CanvasNodeCard } satisfies NodeTypes
const EDGE_TYPES = { canvas: CanvasEdgeLine } satisfies EdgeTypes
const MULTI_SELECTION_KEYS: string[] = ['Meta', 'Control']
const SNAP_GRID: [number, number] = [8, 8]

function minimapNodeColor(node: Node): string {
  const kind = (node as CanvasFlowNode).data.domain.kind
  return kind === 'note' ? '#a9c947' : '#5b8ff5'
}

function toFlowNodes(
  snapshot: ComicCanvasWorkspaceSnapshot,
  workspace: ComicCanvasWorkspace,
  enteringNodeIds: ReadonlySet<string>,
  finishEntry: (nodeId: string) => void,
): CanvasFlowNode[] {
  const selected = new Set(snapshot.selection.nodeIds)
  const resizeVisible = snapshot.selection.nodeIds.length === 1
  return snapshot.document.nodes.map((node) => {
    const previewUrl = workspace.getMediaPreviewUrl(node.id)
    return {
      id: node.id,
      type: 'canvas',
      position: node.position,
      width: node.size.width,
      height: node.size.height,
      selected: selected.has(node.id),
      data: {
        domain: node,
        resizeVisible,
        entering: enteringNodeIds.has(node.id),
        finishEntry,
        ...(previewUrl === undefined ? {} : { previewUrl }),
      },
    }
  })
}

function toFlowEdges(snapshot: ComicCanvasWorkspaceSnapshot): CanvasFlowEdge[] {
  const selected = new Set(snapshot.selection.edgeIds)
  return snapshot.document.edges.map((edge) => ({
    id: edge.id,
    type: 'canvas' as const,
    source: edge.source,
    data: { domainId: edge.id },
    target: edge.target,
    ...(edge.sourceHandle === undefined ? {} : { sourceHandle: edge.sourceHandle }),
    ...(edge.targetHandle === undefined ? {} : { targetHandle: edge.targetHandle }),
    selected: selected.has(edge.id),
  }))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches('input, textarea, select'))
}

function createInputFromDrop(payload: ComicCanvasDropPayload, position: ComicCanvasPoint): Parameters<ComicCanvasWorkspace['createNode']>[0] {
  if (payload.kind === 'note') {
    return { kind: payload.kind, position, title: payload.title, text: payload.text }
  }
  if (payload.kind === 'image') {
    return {
      kind: payload.kind,
      position,
      title: payload.title,
      source: payload.source,
      alt: payload.alt,
    }
  }
  throw new TypeError('video nodes are not supported by Convax Comic')
}

export function promptNodeTitle(prompt: string): string {
  const compact = prompt.trim().replace(/\s+/g, ' ')
  const characters = Array.from(compact)
  return characters.length <= 32 ? compact : `${characters.slice(0, 32).join('')}…`
}

function isSupportedDrop(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types)
  return types.includes('Files') || types.includes(CANVAS_DROP_MIME)
}

export interface CanvasViewProps {
  readonly workspace: ComicCanvasWorkspace
}

/** Canvas center surface backed by the V2 ctx.canvasClient projection. */
export function CanvasView({ workspace }: CanvasViewProps): ReactElement {
  const snapshot = useWorkspaceSnapshot(workspace)
  return (
    <ReactFlowProvider>
      <WorkspaceContext.Provider value={workspace}>
        <CanvasSurface workspace={workspace} snapshot={snapshot} />
      </WorkspaceContext.Provider>
    </ReactFlowProvider>
  )
}

function CanvasSurface({ workspace, snapshot }: {
  readonly workspace: ComicCanvasWorkspace
  readonly snapshot: ComicCanvasWorkspaceSnapshot
}): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<ReactFlowInstance<CanvasFlowNode, CanvasFlowEdge> | null>(null)
  const dragDepth = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [miniMapVisible, setMiniMapVisible] = useState(true)
  const [edgesHidden, setEdgesHidden] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [spacePanning, setSpacePanning] = useState(false)
  const [layoutDirection, setLayoutDirection] = useState<CanvasLayoutDirection>('horizontal')
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [prompt, setPrompt] = useState('')
  const [composerPulse, setComposerPulse] = useState(false)
  const [enteringNodeIds, setEnteringNodeIds] = useState<ReadonlySet<string>>(() => new Set())
  const entryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const interaction = useMemo(() => resolveCanvasInteractionPolicy(spacePanning), [spacePanning])
  const finishEntry = useCallback((nodeId: string): void => {
    const timer = entryTimers.current.get(nodeId)
    if (timer !== undefined) clearTimeout(timer)
    entryTimers.current.delete(nodeId)
    setEnteringNodeIds((current) => {
      if (!current.has(nodeId)) return current
      const next = new Set(current)
      next.delete(nodeId)
      return next
    })
  }, [])
  const markEntering = useCallback((nodeIds: readonly string[]): void => {
    if (nodeIds.length === 0) return
    setEnteringNodeIds((current) => new Set([...current, ...nodeIds]))
    for (const nodeId of nodeIds) {
      const current = entryTimers.current.get(nodeId)
      if (current !== undefined) clearTimeout(current)
      entryTimers.current.set(nodeId, setTimeout(() => { finishEntry(nodeId) }, 360))
    }
  }, [finishEntry])
  useEffect(() => () => {
    for (const timer of entryTimers.current.values()) clearTimeout(timer)
    entryTimers.current.clear()
  }, [])
  useEffect(() => {
    if (!composerPulse) return undefined
    const timer = setTimeout(() => { setComposerPulse(false) }, 720)
    return () => { clearTimeout(timer) }
  }, [composerPulse])
  const nodes = useMemo(
    () => toFlowNodes(snapshot, workspace, enteringNodeIds, finishEntry),
    [enteringNodeIds, finishEntry, snapshot.document.nodes, snapshot.selection.nodeIds, workspace],
  )
  const edges = useMemo(
    () => toFlowEdges(snapshot),
    [snapshot.document.edges, snapshot.document.nodes, snapshot.selection.edgeIds],
  )
  const reportError = useCallback((caught: unknown): void => {
    setError(errorMessage(caught))
  }, [])

  const run = useCallback((action: () => void): void => {
    try {
      action()
      setError(undefined)
    } catch (caught) {
      reportError(caught)
    }
  }, [reportError])

  const centerPosition = useCallback((): ComicCanvasPoint => {
    const rect = stageRef.current?.getBoundingClientRect()
    const instance = flowRef.current
    if (rect === undefined || instance === null) return { x: 80, y: 80 }
    return instance.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  }, [])

  const createNode = useCallback((kind: 'note' | 'image'): void => {
    run(() => {
      const center = centerPosition()
      const size = kind === 'note'
        ? { width: 280, height: 180 }
        : { width: 320, height: 240 }
      const cascade = ((snapshot.document.nodes.length % 5) - 2) * 18
      const id = workspace.createNode({
        kind,
        size,
        position: {
          x: center.x - size.width / 2 + cascade,
          y: center.y - size.height / 2 + cascade,
        },
      })
      markEntering([id])
      workspace.setSelection({ nodeIds: [id], edgeIds: [] })
    })
  }, [centerPosition, markEntering, run, snapshot.document.nodes.length, workspace])

  const submitPrompt = useCallback((): void => {
    const value = prompt.trim()
    if (value.length === 0) return
    run(() => {
      const center = centerPosition()
      const size = { width: 360, height: 220 }
      const id = workspace.createNode({
        kind: 'note',
        title: promptNodeTitle(value),
        text: value,
        size,
        position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      })
      markEntering([id])
      workspace.setSelection({ nodeIds: [id], edgeIds: [] })
      setPrompt('')
      setComposerPulse(true)
    })
  }, [centerPosition, markEntering, prompt, run, workspace])

  const duplicateSelection = useCallback((): void => {
    run(() => {
      const ids = workspace.duplicateNodes(snapshot.selection.nodeIds)
      if (ids.length > 0) {
        markEntering(ids)
        workspace.setSelection({ nodeIds: ids, edgeIds: [] })
      }
    })
  }, [markEntering, run, snapshot.selection.nodeIds, workspace])

  const deleteSelection = useCallback((): void => {
    run(() => {
      workspace.removeElements(snapshot.selection.nodeIds, snapshot.selection.edgeIds)
    })
  }, [run, snapshot.selection, workspace])

  const fitCanvas = useCallback((): void => {
    const flow = flowRef.current
    if (flow === null) return
    if (nodes.length === 0) void flow.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 180 })
    else void flow.fitView({ padding: 0.16, duration: 220, maxZoom: 1.5 })
  }, [nodes.length])

  const zoomIn = useCallback((): void => { void flowRef.current?.zoomIn({ duration: 160 }) }, [])
  const zoomOut = useCallback((): void => { void flowRef.current?.zoomOut({ duration: 160 }) }, [])
  const zoomTo = useCallback((zoom: number): void => { void flowRef.current?.zoomTo(zoom, { duration: 180 }) }, [])

  const tidyCanvas = useCallback((direction = layoutDirection): void => {
    run(() => {
      workspace.moveNodes(tidyCanvasNodes(snapshot.document.nodes, direction))
      window.requestAnimationFrame(fitCanvas)
    })
  }, [fitCanvas, layoutDirection, run, snapshot.document.nodes, workspace])

  const runShortcut = useCallback((command: CanvasShortcutCommand): void => {
    if (command === 'duplicate') duplicateSelection()
    else if (command === 'delete') deleteSelection()
    else if (command === 'fit-view') fitCanvas()
    else if (command === 'zoom-in') zoomIn()
    else if (command === 'zoom-out') zoomOut()
    else if (command === 'clear-selection') workspace.setSelection({ nodeIds: [], edgeIds: [] })
    else if (command === 'select-all') workspace.setSelection({
      nodeIds: snapshot.document.nodes.map(node => node.id),
      edgeIds: [],
    })
    else if (command === 'undo') workspace.undo()
    else if (command === 'redo') workspace.redo()
    else if (command === 'tidy') tidyCanvas()
  }, [deleteSelection, duplicateSelection, fitCanvas, snapshot.document.nodes, tidyCanvas, workspace, zoomIn, zoomOut])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) return
      if (event.code === 'Space' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        if (!event.repeat) setSpacePanning(true)
        return
      }
      const command = resolveCanvasShortcut(event)
      if (command === undefined) return
      event.preventDefault()
      runShortcut(command)
    }
    const onKeyUp = (event: KeyboardEvent): void => { if (event.code === 'Space') setSpacePanning(false) }
    const onBlur = (): void => { setSpacePanning(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [runShortcut])

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]): void => {
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length > 0) {
      const current = workspace.getSnapshot().selection
      workspace.setSelection({
        nodeIds: applyCanvasSelectionChanges(current.nodeIds, selectionChanges),
        edgeIds: current.edgeIds,
      })
    }
    const removed: string[] = []
    for (const change of changes) {
      if (change.type === 'remove') removed.push(change.id)
      if (change.type === 'position' && change.position !== undefined) {
        workspace.moveNode(change.id, change.position)
      }
    }
    if (removed.length > 0) workspace.removeNodes(removed)
  }, [workspace])

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]): void => {
    const selectionChanges = changes.filter((change) => change.type === 'select')
    if (selectionChanges.length > 0) {
      const current = workspace.getSnapshot().selection
      workspace.setSelection({
        nodeIds: current.nodeIds,
        edgeIds: applyCanvasSelectionChanges(current.edgeIds, selectionChanges),
      })
    }
    const removed = changes.filter((change) => change.type === 'remove').map((change) => change.id)
    if (removed.length > 0) workspace.removeEdges(removed)
  }, [workspace])

  const onConnect = useCallback((connection: Connection): void => {
    if (connection.source === null || connection.target === null) return
    run(() => {
      workspace.connect({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    })
  }, [run, workspace])

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isSupportedDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current += 1
    setDragActive(true)
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isSupportedDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (!isSupportedDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }, [])

  const onDrop = useCallback(async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    if (!isSupportedDrop(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDragActive(false)
    const instance = flowRef.current
    if (instance === null) return
    const position = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    try {
      let ids: readonly string[]
      if (event.dataTransfer.types.includes('Files') && event.dataTransfer.files.length > 0) {
        ids = await workspace.addDroppedFiles(event.dataTransfer.files, position)
      } else {
        const raw = event.dataTransfer.getData(CANVAS_DROP_MIME)
        const payload = parseCanvasDropPayload(raw)
        ids = [workspace.createNode(createInputFromDrop(payload, position))]
      }
      markEntering(ids)
      workspace.setSelection({ nodeIds: ids, edgeIds: [] })
      setError(undefined)
    } catch (caught) {
      reportError(caught)
    }
  }, [markEntering, reportError, workspace])

  const onViewportChange = useCallback((viewport: Viewport): void => {
    workspace.setViewport(viewport)
  }, [workspace])

  return (
    <section className="cvxCanvasOverlay" aria-label="Convax 画布">
      <CanvasStyles />
      <main className="cvxCanvasBody">
        <div
          ref={stageRef}
          className={`cvxCanvasStage${spacePanning ? ' cvxCanvasStageHand' : ''}`}
          data-canvas-tool={spacePanning ? 'pan' : 'edit'}
          tabIndex={0}
          onPointerDownCapture={() => { stageRef.current?.focus({ preventScroll: true }) }}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={(event) => { void onDrop(event) }}
        >
          <div className="cvxCanvasFloatingTitle" aria-label={`当前画布：${snapshot.document.title}`}>
            <CanvasIcon size={15} />
            <strong>{snapshot.document.title}</strong>
          </div>
          <div className="cvxCanvasToolbar" role="toolbar" aria-label="画布工具">
            <div className="cvxCanvasTools">
              <Button variant="ghost" size="sm" className="cvxCanvasButton" onClick={() => { createNode('note') }}><NoteIcon /><span className="cvxCanvasActionLabel">文本</span></Button>
              <Button variant="ghost" size="sm" className="cvxCanvasButton" onClick={() => { createNode('image') }}><ImageIcon /><span className="cvxCanvasActionLabel">图片</span></Button>
            </div>
            <span className="cvxCanvasDivider" />
            <div className="cvxCanvasSelectionActions">
              <Button
                variant="ghost"
                size="icon"
                className="cvxCanvasIconButton"
                aria-label="复制所选节点"
                title="复制所选节点 (⌘/Ctrl+D)"
                disabled={snapshot.selection.nodeIds.length === 0}
                onClick={duplicateSelection}
              ><DuplicateIcon /></Button>
              <Button
                variant="ghost"
                size="icon"
                className="cvxCanvasIconButton cvxCanvasButtonDanger"
                aria-label="删除所选内容"
                title="删除所选内容"
                disabled={snapshot.selection.nodeIds.length === 0 && snapshot.selection.edgeIds.length === 0}
                onClick={deleteSelection}
              ><TrashIcon /></Button>
            </div>
          </div>
          <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
            className="cvxCanvasFlow"
            nodes={nodes}
            edges={edgesHidden ? [] : edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            viewport={snapshot.document.viewport}
            minZoom={0.08}
            maxZoom={4}
            deleteKeyCode={null}
            multiSelectionKeyCode={MULTI_SELECTION_KEYS}
            connectOnClick={false}
            connectionDragThreshold={4}
            {...CANVAS_NODE_POINTER_POLICY}
            elementsSelectable={interaction.elementsSelectable}
            nodesConnectable={interaction.nodesConnectable}
            nodesDraggable={interaction.nodesDraggable}
            panActivationKeyCode={null}
            panOnDrag={interaction.panOnDrag}
            panOnScroll
            selectionKeyCode={null}
            selectionOnDrag={interaction.selectionOnDrag}
            snapGrid={SNAP_GRID}
            snapToGrid={snapEnabled}
            zoomActivationKeyCode={null}
            zoomOnDoubleClick={false}
            zoomOnScroll={false}
            onInit={(instance) => { flowRef.current = instance }}
            onNodeDragStart={() => { workspace.beginGesture() }}
            onNodeDragStop={() => { workspace.endGesture() }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onViewportChange={onViewportChange}
            onPaneClick={() => {
              if (!spacePanning) workspace.setSelection({ nodeIds: [], edgeIds: [] })
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--cvx-canvas-line-strong)" />
            {miniMapVisible && (
              <MiniMap
                pannable
                zoomable
                nodeColor={minimapNodeColor}
                maskColor="color-mix(in srgb, var(--cvx-canvas-base) 78%, transparent)"
              />
            )}
          </ReactFlow>
          <form
            className="cvxCanvasComposer"
            data-pulse={composerPulse || undefined}
            data-canvas-shortcuts="ignore"
            onSubmit={(event) => {
              event.preventDefault()
              submitPrompt()
            }}
          >
            <div className="cvxCanvasComposerBeam">
              <div className="cvxCanvasComposerSurface">
                <span className="cvxCanvasComposerSpark" aria-hidden="true"><SparklesIcon size={17} /></span>
                <input
                  aria-label="快速创建灵感卡片"
                  value={prompt}
                  maxLength={4_000}
                  placeholder="描述一个画面、分镜或创作灵感…"
                  onChange={(event) => { setPrompt(event.currentTarget.value) }}
                />
                <button
                  type="submit"
                  className="cvxCanvasComposerSubmit"
                  aria-label="创建灵感卡片"
                  disabled={prompt.trim().length === 0}
                  onAnimationEnd={() => { setComposerPulse(false) }}
                >
                  <SparklesIcon size={16} />
                </button>
              </div>
            </div>
            <span className="cvxCanvasComposerHint">Enter 创建文本节点</span>
          </form>
          <ViewportToolbar
            zoom={snapshot.document.viewport.zoom}
            zoomMenuOpen={zoomMenuOpen}
            miniMapVisible={miniMapVisible}
            edgesHidden={edgesHidden}
            snapEnabled={snapEnabled}
            layoutDirection={layoutDirection}
            onZoomMenuChange={setZoomMenuOpen}
            onEdgesHiddenChange={() => { setEdgesHidden(value => !value) }}
            onSnapChange={() => { setSnapEnabled(value => !value) }}
            onLayout={() => { tidyCanvas() }}
            onLayoutDirectionChange={(direction) => {
              setLayoutDirection(direction)
              tidyCanvas(direction)
            }}
            onMiniMapChange={() => { setMiniMapVisible(value => !value) }}
            onFit={fitCanvas}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onZoomPreset={zoomTo}
          />
          {dragActive && (
            <div className="cvxCanvasDropCue">
              <div><DownloadIcon size={25} /><span>放下图片或 Canvas 节点</span></div>
            </div>
          )}
          {error !== undefined && (
            <div className="cvxCanvasError" role="alert">
              <span>{error}</span>
              <button type="button" aria-label="关闭错误" onClick={() => { setError(undefined) }}><CloseIcon size={15} /></button>
            </div>
          )}
        </div>
      </main>
    </section>
  )
}

const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

function ViewportToolbar(props: {
  readonly zoom: number
  readonly zoomMenuOpen: boolean
  readonly miniMapVisible: boolean
  readonly edgesHidden: boolean
  readonly snapEnabled: boolean
  readonly layoutDirection: CanvasLayoutDirection
  readonly onZoomMenuChange: (open: boolean) => void
  readonly onEdgesHiddenChange: () => void
  readonly onSnapChange: () => void
  readonly onLayout: () => void
  readonly onLayoutDirectionChange: (direction: CanvasLayoutDirection) => void
  readonly onMiniMapChange: () => void
  readonly onFit: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onZoomPreset: (zoom: number) => void
}): ReactElement {
  const zoomMenuRef = useRef<HTMLDivElement>(null)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  useEffect(() => {
    if (!props.zoomMenuOpen && !layoutMenuOpen) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Element && (
        zoomMenuRef.current?.contains(event.target)
        || layoutMenuRef.current?.contains(event.target)
      )) return
      props.onZoomMenuChange(false)
      setLayoutMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      props.onZoomMenuChange(false)
      setLayoutMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [layoutMenuOpen, props.zoomMenuOpen, props.onZoomMenuChange])
  return (
    <div className="cvxViewportToolbar" role="toolbar" aria-label="画布视图控制">
      <Button variant="ghost" size="icon" className="cvxCanvasIconButton" aria-label="适应画布" title="适应画布 (⌘/Ctrl+0)" onClick={props.onFit}><FocusIcon /></Button>
      <Button
        variant="ghost"
        size="icon"
        className="cvxCanvasIconButton"
        aria-label={props.edgesHidden ? '显示连线' : '隐藏连线'}
        aria-pressed={props.edgesHidden}
        title={props.edgesHidden ? '显示连线' : '隐藏连线'}
        data-active={props.edgesHidden}
        onClick={props.onEdgesHiddenChange}
      ><EdgeVisibilityIcon hidden={props.edgesHidden} /></Button>
      <div ref={layoutMenuRef} className="cvxLayoutControl">
        <Button
          variant="ghost"
          size="icon"
          className="cvxCanvasIconButton"
          aria-label="整理画布"
          title="整理画布 (⌥⇧F)"
          onClick={props.onLayout}
        ><LayoutIcon /></Button>
        <button
          type="button"
          className="cvxLayoutDirectionTrigger"
          aria-label="选择整理方向"
          aria-haspopup="menu"
          aria-expanded={layoutMenuOpen}
          title="选择整理方向"
          onClick={() => {
            props.onZoomMenuChange(false)
            setLayoutMenuOpen(open => !open)
          }}
        ><ChevronUpIcon size={12} /></button>
        {layoutMenuOpen && (
          <div className="cvxZoomMenu cvxLayoutMenu" role="menu" aria-label="整理方向">
            <div className="cvxZoomMenuTitle">整理方向</div>
            {(['horizontal', 'vertical'] as const).map(direction => (
              <button
                key={direction}
                type="button"
                role="menuitemradio"
                aria-checked={props.layoutDirection === direction}
                onClick={() => {
                  props.onLayoutDirectionChange(direction)
                  setLayoutMenuOpen(false)
                }}
              >
                <span>{direction === 'horizontal' ? '横向排列' : '纵向排列'}</span>
                {props.layoutDirection === direction && <CheckIcon size={13} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="cvxCanvasIconButton"
        aria-label={props.snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
        aria-pressed={props.snapEnabled}
        title={props.snapEnabled ? '网格吸附：开' : '网格吸附：关'}
        data-active={props.snapEnabled}
        onClick={props.onSnapChange}
      ><MagnetIcon /></Button>
      <Button
        variant="ghost"
        size="icon"
        className="cvxCanvasIconButton"
        aria-label={props.miniMapVisible ? '隐藏小地图' : '显示小地图'}
        aria-pressed={props.miniMapVisible}
        title="小地图"
        data-active={props.miniMapVisible}
        onClick={props.onMiniMapChange}
      ><MapIcon /></Button>
      <span className="cvxCanvasDivider" />
      <Button variant="ghost" size="icon" className="cvxCanvasIconButton" aria-label="缩小" title="缩小 (⌘/Ctrl+-)" onClick={props.onZoomOut}><ZoomOutIcon /></Button>
      <div ref={zoomMenuRef} className="cvxZoomControl">
        <button
          type="button"
          className="cvxZoomTrigger"
          aria-haspopup="menu"
          aria-expanded={props.zoomMenuOpen}
          onClick={() => {
            setLayoutMenuOpen(false)
            props.onZoomMenuChange(!props.zoomMenuOpen)
          }}
        ><span>{Math.round(props.zoom * 100)}%</span><ChevronUpIcon size={13} /></button>
        {props.zoomMenuOpen && (
          <div className="cvxZoomMenu" role="menu" aria-label="缩放比例">
            <div className="cvxZoomMenuTitle">缩放</div>
            {ZOOM_PRESETS.map(zoom => (
              <button
                key={zoom}
                type="button"
                role="menuitem"
                onClick={() => {
                  props.onZoomPreset(zoom)
                  props.onZoomMenuChange(false)
                }}
              ><span>{Math.round(zoom * 100)}%</span>{Math.abs(props.zoom - zoom) < 0.01 && <CheckIcon size={13} />}</button>
            ))}
          </div>
        )}
      </div>
      <Button variant="ghost" size="icon" className="cvxCanvasIconButton" aria-label="放大" title="放大 (⌘/Ctrl+=)" onClick={props.onZoomIn}><ZoomInIcon /></Button>
    </div>
  )
}
