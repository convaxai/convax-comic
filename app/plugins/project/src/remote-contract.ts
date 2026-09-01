import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import {
  PROJECT_FILES_NAMESPACE,
  PROJECT_FILES_RESPONSE_CAP,
  PROJECT_IMAGE_IMPORT_MAX_BYTES,
  PROJECT_TEXT_IMPORT_MAX_BYTES,
} from './contracts.js'

const SERVICE = 'projectFilesRemote'
const PREFIX = '@convax/project#projectFiles'
const id = z.string().min(1).max(256)
const sequence = z.number().int().nonnegative().refine(Number.isSafeInteger)
const relativePath = z.string().max(4096).superRefine((value, context) => {
  if (value === '') return
  if (value.includes('\\') || value.includes('\0') || value.startsWith('/') || value.endsWith('/')
    || value.split('/').some(part => part === '' || part === '.' || part === '..')) {
    context.addIssue({ code: 'custom', message: 'Expected a strict relative project path' })
  }
})
const entry = z.strictObject({
  name: z.string().min(1).max(1024),
  path: relativePath,
  kind: z.enum(['directory', 'file', 'symlink', 'other']),
  expandable: z.boolean(),
  size: z.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
})

export const PROJECT_FILES_REQUEST_SCHEMAS = Object.freeze({
  open: z.strictObject({ workspaceId: id }),
  list: z.strictObject({
    leaseId: id,
    path: relativePath,
    limit: z.number().int().min(1).max(PROJECT_FILES_RESPONSE_CAP).refine(Number.isSafeInteger).optional(),
  }),
  read: z.strictObject({ workspaceId: id, path: relativePath.refine(path => path !== '', 'Expected a file path') }),
  wait: z.strictObject({
    leaseId: id,
    afterSequence: sequence,
    timeoutMs: z.number().int().min(1).max(30_000).refine(Number.isSafeInteger),
  }),
  close: z.strictObject({ leaseId: id }),
})

export const PROJECT_FILES_RESULT_SCHEMAS = Object.freeze({
  open: z.strictObject({ leaseId: id, workspaceId: id, sequence }),
  list: z.strictObject({
    path: relativePath,
    sequence,
    entries: z.array(entry).max(PROJECT_FILES_RESPONSE_CAP),
    truncated: z.boolean(),
  }),
  read: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('image'), path: relativePath, name: z.string().min(1).max(1024),
      size: z.number().int().nonnegative().max(PROJECT_IMAGE_IMPORT_MAX_BYTES).refine(Number.isSafeInteger),
      mimeType: z.enum(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
      dataBase64: z.string().max(Math.ceil(PROJECT_IMAGE_IMPORT_MAX_BYTES / 3) * 4),
    }),
    z.strictObject({
      kind: z.literal('text'), path: relativePath, name: z.string().min(1).max(1024),
      size: z.number().int().nonnegative().max(PROJECT_TEXT_IMPORT_MAX_BYTES).refine(Number.isSafeInteger),
      mimeType: z.string().min(1).max(128), text: z.string().max(PROJECT_TEXT_IMPORT_MAX_BYTES),
    }),
  ]),
  wait: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('changed'), sequence, paths: z.array(relativePath).max(PROJECT_FILES_RESPONSE_CAP), reset: z.boolean() }),
    z.strictObject({ status: z.literal('timeout'), sequence }),
  ]),
  close: z.strictObject({ closed: z.boolean() }),
})

type Method = keyof typeof PROJECT_FILES_REQUEST_SCHEMAS
const METHODS = ['open', 'list', 'read', 'wait', 'close'] as const satisfies readonly Method[]

function descriptor(method: Method): InvocationDescriptor {
  return Object.freeze({
    id: `${PREFIX}/${method}`,
    service: SERVICE,
    namespace: PROJECT_FILES_NAMESPACE,
    method,
    invocation: { kind: 'direct' as const },
    parameters: [Object.freeze({
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: Object.freeze({ mode: 'strict', typeSymbol: `${PREFIX}/${method}:request`, schema: PROJECT_FILES_REQUEST_SCHEMAS[method] }),
    })],
    ...(method === 'wait' || method === 'read' ? { cancellation: { parameter: 'signal' as const } } : {}),
    result: Object.freeze({ mode: 'strict', typeSymbol: `${PREFIX}/${method}:result`, schema: PROJECT_FILES_RESULT_SCHEMAS[method] }),
  })
}

export const PROJECT_FILES_DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze(METHODS.map(descriptor))

export const PROJECT_FILES_REMOTE_CONTRIBUTION: TypertRemoteContribution = Object.freeze({
  package: '@convax/project',
  descriptors: PROJECT_FILES_DESCRIPTORS,
})

export const PROJECT_FILES_HOST_CONTRIBUTION = Object.freeze({
  package: '@convax/project',
  face: 'host' as const,
  schemas: Object.freeze([]),
  model: Object.freeze({ services: Object.freeze([]), events: Object.freeze([]), objects: Object.freeze([]) }),
  invocations: PROJECT_FILES_DESCRIPTORS,
})
