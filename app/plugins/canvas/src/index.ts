import type { Context } from '@deepseek-ai/cordis'
import { CanvasStoreError, type CanvasStore } from '@convax/canvas-store-api'
import {
  CanvasHostError,
  createCanvasHostService,
  provideCanvasHostService,
} from './host/canvas-host-service.js'
import { registerCanvasV2Tools } from './host/v2-tools.js'
import { CanvasRemoteV2Service } from './remote-v2.js'
import { CANVAS_HOST_TYPERT_V2_CONTRIBUTION } from './remote-v2-contract.js'

export * from './host/canvas-host-service.js'
export * from './host/node-type-registry.js'
export * from './host/v2-tools.js'
export * from './remote-v2.js'
export {
  CANVAS_HOST_TYPERT_V2_CONTRIBUTION,
  CANVAS_REMOTE_V2_CONTRIBUTION,
} from './remote-v2-contract.js'

export interface CanvasPluginConfig {
  readonly workspaceId?: string
  readonly projectId?: string
  readonly canvasId?: string
  readonly title?: string
}

export const name = 'app-canvas'
export const inject = ['tools', 'canvasStore', 'typert']

interface CanvasTypertRegistry {
  register(contribution: typeof CANVAS_HOST_TYPERT_V2_CONTRIBUTION): () => void
}

const DEFAULT_SCOPE = Object.freeze({
  workspaceId: 'workspace:default',
  projectId: 'project:default',
  canvasId: 'canvas:main',
  title: 'Untitled canvas',
})

/** Mount the V2 Host authority, its strict Typert projection, and eight Agent tools. */
export async function apply(ctx: Context, config: CanvasPluginConfig = {}): Promise<void> {
  const store = ctx.get('canvasStore') as CanvasStore | undefined
  if (store === undefined) throw new Error('canvasStore service is required')
  const typert = ctx.get('typert') as CanvasTypertRegistry | undefined
  if (typert === undefined) throw new Error('typert service is required')
  const service = createCanvasHostService(ctx, store)

  const scope = {
    workspaceId: config.workspaceId ?? DEFAULT_SCOPE.workspaceId,
    projectId: config.projectId ?? DEFAULT_SCOPE.projectId,
  }
  try {
    try {
      await service.projects.get(scope)
    } catch (error) {
      if (!(error instanceof CanvasHostError) || error.code !== 'PROJECT_NOT_FOUND') throw error
      try {
        await service.projects.create({
          ...scope,
          canvasId: config.canvasId ?? DEFAULT_SCOPE.canvasId,
          title: config.title ?? DEFAULT_SCOPE.title,
          mutationId: 'canvas:initialize',
          source: '@convax/canvas',
        })
      } catch (createError) {
        // A concurrent Host may have initialized the same shared DB row.
        const raced = (createError instanceof CanvasStoreError && createError.code === 'CONFLICT')
          || (createError instanceof CanvasHostError && createError.code === 'PROJECT_ALREADY_EXISTS')
        if (!raced) throw createError
        await service.projects.get(scope)
      }
    }
  } catch (error) {
    await service.close()
    throw error
  }

  // Publish only a fully initialized authority; bootstrap is intentionally silent.
  provideCanvasHostService(ctx, service)

  // Register strict Host descriptors before exposing the Remote receiver.
  typert.register(CANVAS_HOST_TYPERT_V2_CONTRIBUTION)
  new CanvasRemoteV2Service(ctx)
  ctx.effect(
    () => registerCanvasV2Tools(ctx, service, scope),
    'canvas/v2-agent-tools',
  )
}
