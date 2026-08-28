export const CANVAS_SCHEMA_VERSION = 2 as const
export const MAX_CANVAS_DOCUMENT_BYTES = 16 * 1024 * 1024
export const MAX_CANVAS_PROJECT_BYTES = 64 * 1024 * 1024
export const MAX_CANVAS_NODES = 5_000
export const MAX_CANVAS_EDGES = 10_000
export const MAX_PROJECT_CANVASES = 256
export const MAX_CANVAS_JSON_DEPTH = 64
export const MAX_CANVAS_PATCH_OPERATIONS = 512
export const MAX_CANVAS_PATCH_BYTES = 2 * 1024 * 1024

export type CanvasSchemaVersion = typeof CANVAS_SCHEMA_VERSION
export type ProjectId = string
export type CanvasId = string
export type WorkspaceId = string
export type NodeId = string
export type EdgeId = string

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
export interface JsonObject {
  [key: string]: JsonValue
}

export interface XYPosition {
  x: number
  y: number
}

export interface CanvasViewport extends XYPosition {
  zoom: number
}

export interface CanvasMetadata {
  title: string
}

export interface CanvasNodeStyle extends JsonObject {
  width?: number
  height?: number
}

export interface CanvasNode<TData extends JsonObject = JsonObject> {
  id: NodeId
  type: string
  kindVersion: number
  position: XYPosition
  zIndex: number
  style: CanvasNodeStyle
  data: TData
}

export interface CanvasEdge<TData extends JsonObject = JsonObject> {
  id: EdgeId
  type: string
  kindVersion: number
  source: NodeId
  target: NodeId
  sourceHandle?: string
  targetHandle?: string
  data: TData
}

export interface CanvasDocument {
  schemaVersion: CanvasSchemaVersion
  revision: number
  id: CanvasId
  workspaceId: WorkspaceId
  createdAt: string
  updatedAt: string
  metadata: CanvasMetadata
  viewport: CanvasViewport
  nodes: Record<NodeId, CanvasNode>
  edges: Record<EdgeId, CanvasEdge>
}

export interface CanvasProject {
  schemaVersion: CanvasSchemaVersion
  revision: number
  id: ProjectId
  workspaceId: WorkspaceId
  createdAt: string
  updatedAt: string
  metadata: CanvasMetadata
  activeCanvasId: CanvasId
  canvases: Record<CanvasId, CanvasDocument>
}

export const CANVAS_RUNTIME_ONLY_NODE_FIELDS = [
  'selected',
  'dragging',
  'resizing',
  'measured',
  'positionAbsolute',
  'internals',
] as const

export const CANVAS_RUNTIME_ONLY_EDGE_FIELDS = [
  'selected',
  'animated',
  'interactionWidth',
  'deletable',
  'selectable',
  'focusable',
] as const
