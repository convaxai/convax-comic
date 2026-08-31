import type { Context } from '@deepseek-ai/cordis'
import { CanvasStoreError, type CanvasStore } from '@convax/canvas-store-api'
import {
  CanvasHostError,
  createCanvasHostService,
  provideCanvasHostService,
} from './host/canvas-host-service.js'
import {
  registerCanvasV2Tools,
  type CanvasV2ToolScope,
  type CanvasV2ToolScopeResolver,
} from './host/v2-tools.js'
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
  readonly canvasId?: string
  readonly title?: string
}

export const name = 'app-canvas'
export const inject = ['tools', 'canvasStore', 'typert', 'workspaceRegistry']

interface CanvasWorkspaceEntity {
  readonly id: string
}

interface CanvasWorkspaceRegistry {
  resolveByPath(path: string): Promise<CanvasWorkspaceEntity | undefined>
}

interface CanvasTypertRegistry {
  register(contribution: typeof CANVAS_HOST_TYPERT_V2_CONTRIBUTION): () => void
}

const DEFAULT_CANVAS = Object.freeze({
  canvasId: 'canvas:main',
  title: 'Untitled canvas',
})

const WORKSPACE_PROJECT_ID = 'project:root'

async function ensureCanvasProject(
  service: ReturnType<typeof createCanvasHostService>,
  scope: CanvasV2ToolScope,
  canvasId: string,
  title: string,
): Promise<void> {
  try {
    await service.projects.get(scope)
    return
  } catch (error) {
    if (!(error instanceof CanvasHostError) || error.code !== 'PROJECT_NOT_FOUND') throw error
  }
  try {
    await service.projects.create({
      ...scope,
      canvasId,
      title,
      mutationId: `canvas:initialize:${scope.workspaceId}`,
      source: '@convax/canvas',
    })
  } catch (error) {
    const raced = (error instanceof CanvasStoreError && error.code === 'CONFLICT')
      || (error instanceof CanvasHostError && error.code === 'PROJECT_ALREADY_EXISTS')
    if (!raced) throw error
    await service.projects.get(scope)
  }
}

/** Mount the V2 Host authority, its strict Typert projection, and eight Agent tools. */
export async function apply(ctx: Context, config: CanvasPluginConfig = {}): Promise<void> {
  const store = ctx.get('canvasStore') as CanvasStore | undefined
  if (store === undefined) throw new Error('canvasStore service is required')
  const typert = ctx.get('typert') as CanvasTypertRegistry | undefined
  if (typert === undefined) throw new Error('typert service is required')
  const workspaceRegistry = ctx.get('workspaceRegistry') as CanvasWorkspaceRegistry | undefined
  if (workspaceRegistry === undefined) throw new Error('workspaceRegistry service is required')
  const service = createCanvasHostService(ctx, store)

  const resolveToolScope: CanvasV2ToolScopeResolver = async (execution) => {
    execution.signal.throwIfAborted()
    const cwd = execution.agent?.session.header.cwd
    if (cwd === undefined) {
      throw new Error('Canvas tools require an Agent session bound to a Convax project workspace')
    }
    const workspace = await workspaceRegistry.resolveByPath(cwd)
    execution.signal.throwIfAborted()
    if (workspace === undefined) {
      throw new Error(`current Agent session is not bound to a Convax project workspace: ${cwd}`)
    }
    const scope = {
      workspaceId: String(workspace.id),
      projectId: WORKSPACE_PROJECT_ID,
    }
    execution.signal.throwIfAborted()
    await ensureCanvasProject(
      service,
      scope,
      config.canvasId ?? DEFAULT_CANVAS.canvasId,
      config.title ?? DEFAULT_CANVAS.title,
    )
    execution.signal.throwIfAborted()
    return scope
  }

  // Publish the store-backed authority before any project is selected or created.
  provideCanvasHostService(ctx, service)

  // Register strict Host descriptors before exposing the Remote receiver.
  typert.register(CANVAS_HOST_TYPERT_V2_CONTRIBUTION)
  new CanvasRemoteV2Service(ctx)
  ctx.effect(
    () => registerCanvasV2Tools(ctx, service, resolveToolScope),
    'canvas/v2-agent-tools',
  )
}
