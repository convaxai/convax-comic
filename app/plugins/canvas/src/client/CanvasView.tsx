import {
  Background,
  BackgroundVariant,
  Handle,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
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
  CANVAS_DROP_MIME_V1,
  parseCanvasDropPayload,
  type CanvasDropPayloadV1,
  type CanvasNodeV1,
  type CanvasPointV1,
} from '../schema.ts'
import { CanvasWorkspace, type CanvasWorkspaceSnapshot } from './store.ts'
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
  return <style data-convax-canvas-style>{flowCss}{'\n'}{canvasCss}</style>
}

function useWorkspaceSnapshot(workspace: CanvasWorkspace): CanvasWorkspaceSnapshot {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot)
}

export interface CanvasLauncherProps {
  readonly workspace: CanvasWorkspace
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
  readonly domain: CanvasNodeV1
  readonly previewUrl?: string
  readonly resizeVisible: boolean
} & Record<string, unknown>

type CanvasFlowNode = Node<CanvasFlowData, 'canvas'>
type CanvasFlowEdge = Edge<Record<string, never>>

const WorkspaceContext = createContext<CanvasWorkspace | null>(null)

function useCanvasWorkspace(): CanvasWorkspace {
  const workspace = useContext(WorkspaceContext)
  if (workspace === null) throw new Error('Canvas node rendered without a CanvasWorkspace')
  return workspace
}

export function kindLabel(kind: CanvasNodeV1['kind']): string {
  if (kind === 'note') return '文本'
  if (kind === 'image') return '图片'
  return '旧视频'
}

export function KindIcon({ kind, size = 15 }: { readonly kind: CanvasNodeV1['kind']; readonly size?: number }): ReactElement {
  if (kind === 'note') return <NoteIcon size={size} />
  return <ImageIcon size={size} />
}

const CanvasNodeCard = memo(function CanvasNodeCard({ id, data, selected }: NodeProps<CanvasFlowNode>): ReactElement {
  const workspace = useCanvasWorkspace()
  const node = data.domain
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
      <div className="cvxCanvasNode" data-kind={node.kind}>
        <div className="cvxCanvasNodeHeader">
          <span className="cvxCanvasNodeKind"><KindIcon kind={node.kind} /></span>
          <span className="cvxCanvasNodeTitle">{node.title || kindLabel(node.kind)}</span>
        </div>
        {node.kind === 'note' && (
          <div className="cvxCanvasNodeBody cvxCanvasNoteBody">
            {node.text || '空白文本节点'}
          </div>
        )}
        {node.kind === 'image' && (
          <div className="cvxCanvasNodeBody cvxCanvasMediaBody">
            {data.previewUrl === undefined
              ? <MediaPlaceholder kind="image" />
              : <img src={data.previewUrl} alt={node.alt || node.title} draggable={false} />}
          </div>
        )}
      </div>
      <Handle className="cvxCanvasHandle" type="target" position={Position.Left} />
      <Handle className="cvxCanvasHandle" type="source" position={Position.Right} />
    </>
  )
})

function MediaPlaceholder({ kind }: { readonly kind: 'image' }): ReactElement {
  return (
    <div className="cvxCanvasMediaEmpty">
      <ImageIcon size={26} />
      <span>将图片拖入画布</span>
    </div>
  )
}

const NODE_TYPES = { canvas: CanvasNodeCard } satisfies NodeTypes
const MULTI_SELECTION_KEYS: string[] = ['Meta', 'Control']
const SNAP_GRID: [number, number] = [8, 8]

function minimapNodeColor(node: Node): string {
  const kind = (node as CanvasFlowNode).data.domain.kind
  return kind === 'note' ? '#a9c947' : '#5b8ff5'
}

function toFlowNodes(snapshot: CanvasWorkspaceSnapshot, workspace: CanvasWorkspace): CanvasFlowNode[] {
  const selected = new Set(snapshot.selection.nodeIds)
  const resizeVisible = snapshot.selection.nodeIds.length === 1
  return snapshot.document.nodes.filter(node => node.kind !== 'video').map((node) => {
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
        ...(previewUrl === undefined ? {} : { previewUrl }),
      },
    }
  })
}

function toFlowEdges(snapshot: CanvasWorkspaceSnapshot): CanvasFlowEdge[] {
  const selected = new Set(snapshot.selection.edgeIds)
  const visible = new Set(snapshot.document.nodes.filter(node => node.kind !== 'video').map(node => node.id))
  return snapshot.document.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)).map((edge) => ({
    id: edge.id,
    source: edge.source,
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

function createInputFromDrop(payload: CanvasDropPayloadV1, position: CanvasPointV1): Parameters<CanvasWorkspace['createNode']>[0] {
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

function isSupportedDrop(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types)
  return types.includes('Files') || types.includes(CANVAS_DROP_MIME_V1)
}

export interface CanvasViewProps {
  readonly workspace: CanvasWorkspace
}

/** Canvas center surface backed by the Client projection of ctx.canvas. */
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
  readonly workspace: CanvasWorkspace
  readonly snapshot: CanvasWorkspaceSnapshot
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
  const interaction = useMemo(() => resolveCanvasInteractionPolicy(spacePanning), [spacePanning])
  const nodes = useMemo(
    () => toFlowNodes(snapshot, workspace),
    [snapshot.document.nodes, snapshot.selection.nodeIds, workspace],
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

  const centerPosition = useCallback((): CanvasPointV1 => {
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
      workspace.setSelection({ nodeIds: [id], edgeIds: [] })
    })
  }, [centerPosition, run, snapshot.document.nodes.length, workspace])

  const duplicateSelection = useCallback((): void => {
    run(() => {
      const ids = workspace.duplicateNodes(snapshot.selection.nodeIds)
      if (ids.length > 0) workspace.setSelection({ nodeIds: ids, edgeIds: [] })
    })
  }, [run, snapshot.selection.nodeIds, workspace])

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
      workspace.moveNodes(tidyCanvasNodes(snapshot.document.nodes.filter(node => node.kind !== 'video'), direction))
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
      nodeIds: snapshot.document.nodes.filter(node => node.kind !== 'video').map(node => node.id),
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
        const raw = event.dataTransfer.getData(CANVAS_DROP_MIME_V1)
        const payload = parseCanvasDropPayload(raw)
        ids = [workspace.createNode(createInputFromDrop(payload, position))]
      }
      workspace.setSelection({ nodeIds: ids, edgeIds: [] })
      setError(undefined)
    } catch (caught) {
      reportError(caught)
    }
  }, [reportError, workspace])

  const onViewportChange = useCallback((viewport: Viewport): void => {
    workspace.setViewport(viewport)
  }, [workspace])

  return (
    <section className="cvxCanvasOverlay" aria-label="Convax 画布">
      <CanvasStyles />
      <header className="cvxCanvasTopbar">
        <div className="cvxCanvasBrand">
          <span className="cvxCanvasBrandMark"><CanvasIcon size={17} /></span>
          <span className="cvxCanvasBrandCopy">
            <strong>{snapshot.document.title}</strong>
            <span>Canvas document · v{snapshot.document.version}</span>
          </span>
        </div>
      </header>
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
          <div className="cvxCanvasToolbar" role="toolbar" aria-label="画布工具">
            <div className="cvxCanvasTools">
              <button type="button" className="cvxCanvasButton" onClick={() => { createNode('note') }}><NoteIcon /><span>文本</span></button>
              <button type="button" className="cvxCanvasButton" onClick={() => { createNode('image') }}><ImageIcon /><span>图片</span></button>
            </div>
            <span className="cvxCanvasDivider" />
            <div className="cvxCanvasSelectionActions">
              <button
                type="button"
                className="cvxCanvasIconButton"
                aria-label="复制所选节点"
                title="复制所选节点 (⌘/Ctrl+D)"
                disabled={snapshot.selection.nodeIds.length === 0}
                onClick={duplicateSelection}
              ><DuplicateIcon /></button>
              <button
                type="button"
                className="cvxCanvasIconButton cvxCanvasButtonDanger"
                aria-label="删除所选内容"
                title="删除所选内容"
                disabled={snapshot.selection.nodeIds.length === 0 && snapshot.selection.edgeIds.length === 0}
                onClick={deleteSelection}
              ><TrashIcon /></button>
            </div>
          </div>
          <ReactFlow<CanvasFlowNode, CanvasFlowEdge>
            className="cvxCanvasFlow"
            nodes={nodes}
            edges={edgesHidden ? [] : edges}
            nodeTypes={NODE_TYPES}
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
      <button type="button" className="cvxCanvasIconButton" aria-label="适应画布" title="适应画布 (⌘/Ctrl+0)" onClick={props.onFit}><FocusIcon /></button>
      <button
        type="button"
        className="cvxCanvasIconButton"
        aria-label={props.edgesHidden ? '显示连线' : '隐藏连线'}
        aria-pressed={props.edgesHidden}
        title={props.edgesHidden ? '显示连线' : '隐藏连线'}
        data-active={props.edgesHidden}
        onClick={props.onEdgesHiddenChange}
      ><EdgeVisibilityIcon hidden={props.edgesHidden} /></button>
      <div ref={layoutMenuRef} className="cvxLayoutControl">
        <button
          type="button"
          className="cvxCanvasIconButton"
          aria-label="整理画布"
          title="整理画布 (⌥⇧F)"
          onClick={props.onLayout}
        ><LayoutIcon /></button>
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
      <button
        type="button"
        className="cvxCanvasIconButton"
        aria-label={props.snapEnabled ? '关闭网格吸附' : '开启网格吸附'}
        aria-pressed={props.snapEnabled}
        title={props.snapEnabled ? '网格吸附：开' : '网格吸附：关'}
        data-active={props.snapEnabled}
        onClick={props.onSnapChange}
      ><MagnetIcon /></button>
      <button
        type="button"
        className="cvxCanvasIconButton"
        aria-label={props.miniMapVisible ? '隐藏小地图' : '显示小地图'}
        aria-pressed={props.miniMapVisible}
        title="小地图"
        data-active={props.miniMapVisible}
        onClick={props.onMiniMapChange}
      ><MapIcon /></button>
      <span className="cvxCanvasDivider" />
      <button type="button" className="cvxCanvasIconButton" aria-label="缩小" title="缩小 (⌘/Ctrl+-)" onClick={props.onZoomOut}><ZoomOutIcon /></button>
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
      <button type="button" className="cvxCanvasIconButton" aria-label="放大" title="放大 (⌘/Ctrl+=)" onClick={props.onZoomIn}><ZoomInIcon /></button>
    </div>
  )
}
