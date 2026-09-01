import { z } from 'zod'
import {
  MAX_CANVAS_PATCH_BYTES,
  MAX_CANVAS_PATCH_OPERATIONS,
  assertCanvasEdge,
  assertCanvasId,
  assertCanvasNode,
  assertProjectId,
  assertWorkspaceId,
  decodeJsonPointer,
  isJsonValue,
  parseCanvasDocument,
  parseCanvasProject,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasProject,
} from '@convax/canvas-api'
import type {
  InvocationDescriptor,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

const SERVICE = 'canvasRemoteV2'
const NAMESPACE = 'canvasV2'
const TYPE_PREFIX = '@convax/canvas#canvasV2'

function asserted<T>(assertion: (value: unknown) => asserts value is T): z.ZodType<T> {
  return z.unknown().transform((value, context) => {
    try {
      assertion(value)
      return structuredClone(value)
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
      return z.NEVER
    }
  }) as z.ZodType<T>
}

function parsed<T>(parser: (value: unknown) => T): z.ZodType<T> {
  return z.unknown().transform((value, context) => {
    try {
      return parser(value)
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
      return z.NEVER
    }
  }) as z.ZodType<T>
}

function identifier(assertion: (value: unknown) => void): z.ZodString {
  return z.string().superRefine((value, context) => {
    try {
      assertion(value)
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
    }
  })
}

const workspaceIdSchema = identifier(assertWorkspaceId)
const projectIdSchema = identifier(assertProjectId)
const canvasIdSchema = identifier(assertCanvasId)
const revisionSchema = z.number().int().nonnegative().refine(Number.isSafeInteger)
const nonEmptySchema = z.string().trim().min(1)
const timestampSchema = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)), 'Expected an ISO-8601 UTC timestamp')
const jsonValueSchema = z.custom(value => isJsonValue(value), 'Expected a JSON-safe value')
const nodeSchema = asserted<CanvasNode>(assertCanvasNode)
const edgeSchema = asserted<CanvasEdge>(assertCanvasEdge)
const documentSchema = parsed<CanvasDocument>(parseCanvasDocument)
const projectSchema = parsed<CanvasProject>(parseCanvasProject)

const metadataShape = {
  mutationId: nonEmptySchema,
  source: nonEmptySchema,
  originClientId: nonEmptySchema.optional(),
}
const identityShape = {
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
}
const documentIdentityShape = {
  ...identityShape,
  canvasId: canvasIdSchema,
}

function isMutableReplacePath(segments: readonly string[]): boolean {
  if (segments[0] === 'metadata') return segments.length === 2 && segments[1] === 'title'
  if (segments[0] === 'viewport') {
    return segments.length === 2 && ['x', 'y', 'zoom'].includes(segments[1] ?? '')
  }
  if (segments[0] === 'nodes' && segments.length >= 3) {
    if (segments[2] === 'zIndex') return segments.length === 3
    if (segments[2] === 'position') {
      return segments.length === 4 && ['x', 'y'].includes(segments[3] ?? '')
    }
    return (segments[2] === 'style' || segments[2] === 'data') && segments.length >= 4
  }
  return segments[0] === 'edges' && segments[2] === 'data' && segments.length >= 4
}

const patchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), path: z.string(), value: z.union([nodeSchema, edgeSchema]) }),
  z.strictObject({ op: z.literal('remove'), path: z.string() }),
  z.strictObject({ op: z.literal('replace'), path: z.string(), value: jsonValueSchema }),
]).superRefine((operation, context) => {
  try {
    const segments = decodeJsonPointer(operation.path)
    if (operation.op === 'add') {
      const expectedCollection = 'position' in operation.value ? 'nodes' : 'edges'
      if (segments.length !== 2 || segments[0] !== expectedCollection || segments[1] !== operation.value.id) {
        context.addIssue({ code: 'custom', message: 'Canvas add path must exactly match its entity' })
      }
    } else if (operation.op === 'remove') {
      if (segments.length !== 2 || !['nodes', 'edges'].includes(segments[0] ?? '')) {
        context.addIssue({ code: 'custom', message: 'Canvas remove path must target one entity' })
      }
    } else if (!isMutableReplacePath(segments)) {
      context.addIssue({ code: 'custom', message: 'Canvas replace path is not a mutable leaf' })
    }
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
})
const operationsSchema = z.array(patchOperationSchema)
  .min(1)
  .max(MAX_CANVAS_PATCH_OPERATIONS)
  .superRefine((operations, context) => {
    if (new TextEncoder().encode(JSON.stringify(operations)).byteLength > MAX_CANVAS_PATCH_BYTES) {
      context.addIssue({ code: 'custom', message: `Canvas patch exceeds ${MAX_CANVAS_PATCH_BYTES} JSON bytes` })
    }
  })

export const CANVAS_REMOTE_V2_REQUEST_SCHEMAS = Object.freeze({
  listProjects: z.strictObject({ workspaceId: workspaceIdSchema }),
  createProject: z.strictObject({
    ...identityShape,
    canvasId: canvasIdSchema,
    title: z.string(),
    ...metadataShape,
  }),
  getProject: z.strictObject(identityShape),
  setActiveCanvas: z.strictObject({
    ...documentIdentityShape,
    expectedRevision: revisionSchema,
    ...metadataShape,
  }),
  deleteProject: z.strictObject({
    ...identityShape,
    expectedRevision: revisionSchema,
    ...metadataShape,
  }),
  listDocuments: z.strictObject(identityShape),
  createDocument: z.strictObject({
    ...documentIdentityShape,
    title: z.string(),
    expectedProjectRevision: revisionSchema,
    ...metadataShape,
  }),
  getDocument: z.strictObject(documentIdentityShape),
  renameDocument: z.strictObject({
    ...documentIdentityShape,
    expectedRevision: revisionSchema,
    title: z.string(),
    ...metadataShape,
  }),
  deleteDocument: z.strictObject({
    ...documentIdentityShape,
    expectedRevision: revisionSchema,
    ...metadataShape,
  }),
  applyPatch: z.strictObject({
    ...documentIdentityShape,
    expectedRevision: revisionSchema,
    operations: operationsSchema,
    ...metadataShape,
  }),
  waitForRevision: z.strictObject({
    ...documentIdentityShape,
    afterRevision: revisionSchema,
    timeoutMs: z.number().int().min(1).max(30_000).refine(Number.isSafeInteger),
  }),
})

const projectSummarySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  title: z.string(),
  activeCanvasId: canvasIdSchema,
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
const documentSummarySchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  canvasId: canvasIdSchema,
  title: z.string(),
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})
const deleteProjectResultSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  deleted: z.boolean(),
})
const deleteDocumentResultSchema = z.strictObject({
  workspaceId: workspaceIdSchema,
  projectId: projectIdSchema,
  canvasId: canvasIdSchema,
  deleted: z.boolean(),
})
const applyPatchResultSchema = z.strictObject({
  document: documentSchema,
  revision: revisionSchema,
  applied: z.number().int().nonnegative().max(MAX_CANVAS_PATCH_OPERATIONS).refine(Number.isSafeInteger),
}).superRefine((result, context) => {
  if (result.revision !== result.document.revision) {
    context.addIssue({ code: 'custom', message: 'Patch result revision must match document revision' })
  }
})
const waitForRevisionResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('changed'), document: documentSchema }),
  z.strictObject({ status: z.literal('timeout'), revision: revisionSchema }),
  z.strictObject({ status: z.literal('deleted') }),
])

export const CANVAS_REMOTE_V2_RESULT_SCHEMAS = Object.freeze({
  listProjects: z.array(projectSummarySchema),
  createProject: projectSchema,
  getProject: projectSchema,
  setActiveCanvas: projectSchema,
  deleteProject: deleteProjectResultSchema,
  listDocuments: z.array(documentSummarySchema),
  createDocument: documentSchema,
  getDocument: documentSchema,
  renameDocument: documentSchema,
  deleteDocument: deleteDocumentResultSchema,
  applyPatch: applyPatchResultSchema,
  waitForRevision: waitForRevisionResultSchema,
})

type RemoteMethod = keyof typeof CANVAS_REMOTE_V2_REQUEST_SCHEMAS

function descriptor(method: RemoteMethod): InvocationDescriptor {
  return Object.freeze({
    id: `${TYPE_PREFIX}/${method}`,
    service: SERVICE,
    namespace: NAMESPACE,
    method,
    invocation: { kind: 'direct' as const },
    parameters: [Object.freeze({
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: `${TYPE_PREFIX}/${method}:request`,
        schema: CANVAS_REMOTE_V2_REQUEST_SCHEMAS[method],
      }),
    })],
    ...(method === 'waitForRevision' ? { cancellation: { parameter: 'signal' as const } } : {}),
    result: Object.freeze({
      mode: 'strict',
      typeSymbol: `${TYPE_PREFIX}/${method}:result`,
      schema: CANVAS_REMOTE_V2_RESULT_SCHEMAS[method],
    }),
  })
}

const METHODS = [
  'listProjects',
  'createProject',
  'getProject',
  'setActiveCanvas',
  'deleteProject',
  'listDocuments',
  'createDocument',
  'getDocument',
  'renameDocument',
  'deleteDocument',
  'applyPatch',
  'waitForRevision',
] as const satisfies readonly RemoteMethod[]

export const CANVAS_REMOTE_V2_DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze(
  METHODS.map(descriptor),
)

export const CANVAS_REMOTE_V2_CONTRIBUTION: TypertRemoteContribution = Object.freeze({
  package: '@convax/canvas',
  descriptors: CANVAS_REMOTE_V2_DESCRIPTORS,
})

/** Host-face strict invocation contribution consumed by the Typert registry. */
export const CANVAS_HOST_TYPERT_V2_CONTRIBUTION = Object.freeze({
  package: '@convax/canvas',
  face: 'host' as const,
  schemas: Object.freeze([]),
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
  invocations: CANVAS_REMOTE_V2_DESCRIPTORS,
})
