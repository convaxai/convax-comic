import { z } from 'zod'
import type { InvocationDescriptor, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

export interface CanvasWireSnapshot {
  readonly revision: number
  readonly documentJson: string
  readonly activeCanvasId: string
  readonly canvases: readonly CanvasWireSummary[]
}

export interface CanvasWireSummary {
  readonly id: string
  readonly title: string
  readonly nodeCount: number
  readonly edgeCount: number
}

const stringSchema = z.string()
const revisionSchema = z.number().int().nonnegative()
const snapshotSchema = z.object({
  revision: revisionSchema,
  documentJson: stringSchema,
  activeCanvasId: stringSchema,
  canvases: z.array(z.object({
    id: stringSchema,
    title: stringSchema,
    nodeCount: revisionSchema,
    edgeCount: revisionSchema,
  })),
})

export const CANVAS_REMOTE_DESCRIPTORS: readonly InvocationDescriptor[] = Object.freeze([
  {
    id: '@convax/canvas#canvas/read',
    service: 'canvas',
    namespace: 'canvas',
    method: 'read',
    implementation: 'readJson',
    invocation: { kind: 'direct' },
    parameters: [],
    result: {
      mode: 'strict',
      typeSymbol: '@convax/canvas#CanvasWireSnapshot',
      schema: snapshotSchema,
    },
  },
  {
    id: '@convax/canvas#canvas/replace',
    service: 'canvas',
    namespace: 'canvas',
    method: 'replace',
    implementation: 'replaceJson',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'documentJson',
        wire: 'documentJson',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/replace:documentJson',
          schema: stringSchema,
        },
      },
      {
        name: 'expectedRevision',
        wire: 'expectedRevision',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/replace:expectedRevision',
          schema: revisionSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: '@convax/canvas#CanvasWireSnapshot',
      schema: snapshotSchema,
    },
  },
  {
    id: '@convax/canvas#canvas/create',
    service: 'canvas',
    namespace: 'canvas',
    method: 'create',
    implementation: 'createCanvasJson',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'title',
        wire: 'title',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/create:title',
          schema: stringSchema,
        },
      },
      {
        name: 'expectedRevision',
        wire: 'expectedRevision',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/create:expectedRevision',
          schema: revisionSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: '@convax/canvas#CanvasWireSnapshot',
      schema: snapshotSchema,
    },
  },
  {
    id: '@convax/canvas#canvas/select',
    service: 'canvas',
    namespace: 'canvas',
    method: 'select',
    implementation: 'selectCanvasJson',
    invocation: { kind: 'direct' },
    parameters: [
      {
        name: 'canvasId',
        wire: 'canvasId',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/select:canvasId',
          schema: stringSchema,
        },
      },
      {
        name: 'expectedRevision',
        wire: 'expectedRevision',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: '@convax/canvas#canvas/select:expectedRevision',
          schema: revisionSchema,
        },
      },
    ],
    result: {
      mode: 'strict',
      typeSymbol: '@convax/canvas#CanvasWireSnapshot',
      schema: snapshotSchema,
    },
  },
])

export const CANVAS_REMOTE_CONTRIBUTION: TypertRemoteContribution = Object.freeze({
  package: '@convax/canvas',
  descriptors: CANVAS_REMOTE_DESCRIPTORS,
})
