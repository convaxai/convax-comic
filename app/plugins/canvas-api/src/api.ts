import type { Context } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import type { ApplyCanvasPatchResult, CanvasPatchOperation } from './patch.js'
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasId,
  CanvasNode,
  CanvasProject,
  CanvasViewport,
  EdgeId,
  JsonObject,
  JsonValue,
  NodeId,
  ProjectId,
  WorkspaceId,
} from './types.js'

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export interface CanvasNodeTypeDefinition<TData extends JsonObject = JsonObject> {
  type: string
  kindVersion: number
  createData(): TData
  validateData(data: unknown): data is TData
}

export interface CanvasEdgeTypeDefinition<TData extends JsonObject = JsonObject> {
  type: string
  kindVersion: number
  createData(): TData
  validateData(data: unknown): data is TData
}

export interface CanvasNodeUpdate {
  position?: { x?: number; y?: number }
  zIndex?: number
  style?: Readonly<Record<string, JsonValue>>
  data?: Readonly<Record<string, JsonValue>>
}

export interface CanvasEdgeUpdate {
  data?: Readonly<Record<string, JsonValue>>
}

export interface CanvasNodeActions {
  update(changes: CanvasNodeUpdate): Promise<ApplyCanvasPatchResult>
  remove(): Promise<ApplyCanvasPatchResult>
  select(selected?: boolean): void
  focus(): void
}

export interface CanvasEdgeActions {
  update(changes: CanvasEdgeUpdate): Promise<ApplyCanvasPatchResult>
  remove(): Promise<ApplyCanvasPatchResult>
  select(selected?: boolean): void
}

export interface CanvasNodeRendererProps<TData extends JsonObject = JsonObject> {
  sessionId: string
  node: DeepReadonly<CanvasNode<TData>>
  selected: boolean
  actions: CanvasNodeActions
}

export interface CanvasEdgeRendererProps<TData extends JsonObject = JsonObject> {
  sessionId: string
  edge: DeepReadonly<CanvasEdge<TData>>
  selected: boolean
  actions: CanvasEdgeActions
}

export type CanvasNodeRenderer<TData extends JsonObject = JsonObject> = ComponentType<CanvasNodeRendererProps<TData>>
export type CanvasEdgeRenderer<TData extends JsonObject = JsonObject> = ComponentType<CanvasEdgeRendererProps<TData>>

export interface CanvasNodeRendererRegistration<TData extends JsonObject = JsonObject> {
  type: string
  kindVersion: number
  renderer: CanvasNodeRenderer<TData>
}

export interface CanvasEdgeRendererRegistration<TData extends JsonObject = JsonObject> {
  type: string
  kindVersion: number
  renderer: CanvasEdgeRenderer<TData>
}

export interface CanvasRendererRegistry {
  registerNode<TData extends JsonObject>(registration: CanvasNodeRendererRegistration<TData>): () => void
  registerEdge<TData extends JsonObject>(registration: CanvasEdgeRendererRegistration<TData>): () => void
  hasNode(type: string, kindVersion?: number): boolean
  hasEdge(type: string, kindVersion?: number): boolean
  subscribe(listener: () => void): () => void
}

export interface CanvasMutationMetadata {
  mutationId: string
  source: string
  originClientId?: string
}

export interface ListCanvasProjectsRequest { workspaceId: WorkspaceId }
export interface CreateCanvasProjectRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; title: string }
export interface GetCanvasProjectRequest { workspaceId: WorkspaceId; projectId: ProjectId }
export interface DeleteCanvasProjectRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; expectedRevision: number }
export interface DeleteCanvasProjectResult { workspaceId: WorkspaceId; projectId: ProjectId; deleted: boolean }
export interface SetActiveCanvasRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; expectedRevision: number }
export type CreateCanvasProjectResult = CanvasProject
export type GetCanvasProjectResult = CanvasProject
export type SetActiveCanvasResult = CanvasProject

export interface ListCanvasDocumentsRequest { workspaceId: WorkspaceId; projectId: ProjectId }
export interface CreateCanvasDocumentRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; title: string; expectedProjectRevision: number }
export interface GetCanvasDocumentRequest { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId }
export interface RenameCanvasDocumentRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; expectedRevision: number; title: string }
export interface DeleteCanvasDocumentRequest extends CanvasMutationMetadata { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; expectedRevision: number }
export interface DeleteCanvasDocumentResult { workspaceId: WorkspaceId; projectId: ProjectId; canvasId: CanvasId; deleted: boolean }
export type CreateCanvasDocumentResult = CanvasDocument
export type GetCanvasDocumentResult = CanvasDocument

export interface ApplyCanvasPatchRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  operations: readonly CanvasPatchOperation[]
}

/** Atomic authority operation used by active-canvas Agent/tool mutations. */
export interface ApplyActiveCanvasPatchRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  expectedProjectRevision: number
  expectedActiveCanvasId: CanvasId
  expectedRevision: number
  operations: readonly CanvasPatchOperation[]
}

export interface CreateCanvasNodeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  node: CanvasNode
}

export interface UpdateCanvasNodeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  nodeId: NodeId
  changes: CanvasNodeUpdate
}

export interface RemoveCanvasNodeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  nodeId: NodeId
}

export interface CreateCanvasEdgeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  edge: CanvasEdge
}

export interface UpdateCanvasEdgeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  edgeId: EdgeId
  changes: CanvasEdgeUpdate
}

export interface RemoveCanvasEdgeRequest extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  expectedRevision: number
  edgeId: EdgeId
}

export interface WaitForCanvasRevisionRequest {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  afterRevision: number
  timeoutMs: number
}

export interface CanvasRevisionChangedResult { status: 'changed'; document: CanvasDocument }
export interface CanvasRevisionTimeoutResult { status: 'timeout'; revision: number }
export interface CanvasRevisionDeletedResult { status: 'deleted' }
export type WaitForCanvasRevisionResult = CanvasRevisionChangedResult | CanvasRevisionTimeoutResult | CanvasRevisionDeletedResult

export interface CanvasCommittedEvent extends CanvasMutationMetadata {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  revision: number
  operations: readonly CanvasPatchOperation[]
}

export type CanvasCommittedEventDisposition = 'applied' | 'duplicate' | 'refresh-required'

export function classifyCanvasCommittedEvent(
  workspaceId: WorkspaceId,
  projectId: ProjectId,
  canvasId: CanvasId,
  currentRevision: number,
  event: CanvasCommittedEvent,
): CanvasCommittedEventDisposition {
  if (event.workspaceId !== workspaceId || event.projectId !== projectId || event.canvasId !== canvasId) return 'refresh-required'
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || !Number.isSafeInteger(event.revision) || event.revision < 0) return 'refresh-required'
  if (event.revision <= currentRevision) return 'duplicate'
  return event.revision === currentRevision + 1 ? 'applied' : 'refresh-required'
}

export interface CanvasProjectSummary {
  workspaceId: WorkspaceId
  projectId: ProjectId
  title: string
  activeCanvasId: CanvasId
  revision: number
  createdAt: string
  updatedAt: string
}

export interface CanvasDocumentSummary {
  workspaceId: WorkspaceId
  projectId: ProjectId
  canvasId: CanvasId
  title: string
  revision: number
  createdAt: string
  updatedAt: string
}

export type ListCanvasProjectsResult = readonly CanvasProjectSummary[]
export type ListCanvasDocumentsResult = readonly CanvasDocumentSummary[]

export interface CanvasHostProjectsApi {
  list(request: ListCanvasProjectsRequest): Promise<readonly CanvasProjectSummary[]>
  create(request: CreateCanvasProjectRequest): Promise<CanvasProject>
  get(request: GetCanvasProjectRequest): Promise<CanvasProject>
  setActiveCanvas(request: SetActiveCanvasRequest): Promise<CanvasProject>
  delete(request: DeleteCanvasProjectRequest): Promise<DeleteCanvasProjectResult>
}

export interface CanvasHostDocumentsApi {
  list(request: ListCanvasDocumentsRequest): Promise<readonly CanvasDocumentSummary[]>
  create(request: CreateCanvasDocumentRequest): Promise<CanvasDocument>
  createAndActivate(request: CreateCanvasDocumentRequest): Promise<CanvasDocument>
  get(request: GetCanvasDocumentRequest): Promise<CanvasDocument>
  rename(request: RenameCanvasDocumentRequest): Promise<CanvasDocument>
  delete(request: DeleteCanvasDocumentRequest): Promise<DeleteCanvasDocumentResult>
  applyPatch(request: ApplyCanvasPatchRequest): Promise<ApplyCanvasPatchResult>
  applyActivePatch(request: ApplyActiveCanvasPatchRequest): Promise<ApplyCanvasPatchResult>
  waitForRevision(request: WaitForCanvasRevisionRequest, signal: AbortSignal): Promise<WaitForCanvasRevisionResult>
}

export interface CanvasHostNodesApi {
  create(request: CreateCanvasNodeRequest): Promise<ApplyCanvasPatchResult>
  update(request: UpdateCanvasNodeRequest): Promise<ApplyCanvasPatchResult>
  remove(request: RemoveCanvasNodeRequest): Promise<ApplyCanvasPatchResult>
}

export interface CanvasHostEdgesApi {
  create(request: CreateCanvasEdgeRequest): Promise<ApplyCanvasPatchResult>
  update(request: UpdateCanvasEdgeRequest): Promise<ApplyCanvasPatchResult>
  remove(request: RemoveCanvasEdgeRequest): Promise<ApplyCanvasPatchResult>
}

export interface CanvasHostApi {
  readonly projects: CanvasHostProjectsApi
  readonly documents: CanvasHostDocumentsApi
  readonly nodes: CanvasHostNodesApi
  readonly edges: CanvasHostEdgesApi
  registerNodeType(definition: CanvasNodeTypeDefinition): () => void
  registerEdgeType(definition: CanvasEdgeTypeDefinition): () => void
}

export interface CanvasClientPatchRequest {
  operations: readonly CanvasPatchOperation[]
  mutationId?: string
  source?: string
}

export interface CanvasClientActions {
  applyPatch(request: CanvasClientPatchRequest): Promise<ApplyCanvasPatchResult>
  setViewport(viewport: CanvasViewport): Promise<ApplyCanvasPatchResult>
  selectNodes(nodeIds: readonly NodeId[]): void
  selectEdges(edgeIds: readonly EdgeId[]): void
  fitView(nodeIds?: readonly NodeId[]): void
  undo(): Promise<void>
  redo(): Promise<void>
}

export interface CanvasClientApi {
  readonly workspaceId: WorkspaceId
  readonly projectId: ProjectId
  readonly canvasId: CanvasId
  getSnapshot(): CanvasDocument
  refresh(): Promise<CanvasDocument>
  readonly actions: CanvasClientActions
  readonly renderers: CanvasRendererRegistry
  handleCommittedEvent(event: CanvasCommittedEvent): CanvasCommittedEventDisposition
  subscribe(listener: (document: CanvasDocument) => void): () => void
}

export const CANVAS_HOST_SERVICE = 'canvasHost' as const
export const CANVAS_CLIENT_SERVICE = 'canvasClient' as const
export const CANVAS_COMMITTED_EVENT = 'canvas/committed' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    canvasHost: CanvasHostApi
    canvasClient: CanvasClientApi
  }

  interface Events {
    'canvas/committed': (event: CanvasCommittedEvent) => void
  }
}

export type CanvasContext = Context
