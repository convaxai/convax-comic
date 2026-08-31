import type { Context } from '@deepseek-ai/cordis'
import {
  CanvasCenter,
  CanvasProjectCanvases,
} from './Workbench.js'
import {
  CanvasProjectSync,
  type CanvasRemoteV2Api,
} from './project-sync-v2.js'
import { TYPERT_REMOTE_V2 } from '../remote-v2.js'

interface SlotRegistrationOptions {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly label?: string
  readonly children?: Readonly<Record<string, { readonly kind: string; readonly scope: string }>>
  readonly inject?: () => Record<string, unknown>
}

interface SlotRegistry {
  inject(name: string, callback: () => unknown): () => void
  register(options: SlotRegistrationOptions, component: unknown): () => void
}

interface ClientRemoteRoot {
  $mount(contribution: typeof TYPERT_REMOTE_V2): Promise<() => void | Promise<void>>
  readonly canvasV2: CanvasRemoteV2Api
}

interface ComicProjectScope {
  readonly workspaceId: string
  readonly projectId: string
}

type ClientContext = Context & {
  slots: SlotRegistry
  remote: ClientRemoteRoot
  comicProject: ComicProjectScope
}

export interface Config {
  readonly canvasId?: string
  readonly title?: string
}

export const inject = ['slots', 'remote']

/**
 * Canvas is a project-scoped contribution. The project plugin owns the product
 * shell and sidebar; Cordis restarts this fiber when the active project changes.
 */
export async function apply(ctx: ClientContext, config: Config = {}): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE_V2)
  try {
    ctx.inject(['remote.canvasV2', 'comicProject'], async (canvasCtx) => {
      const consumer = canvasCtx as ClientContext
      const scope = consumer.comicProject
      if (scope.projectId !== 'project:root') {
        throw new Error(`unsupported Comic project scope: ${scope.projectId}`)
      }
      const sync = new CanvasProjectSync(consumer.remote.canvasV2, {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        workspace: { initiallyOpen: true },
        ensureProject: {
          canvasId: config.canvasId ?? 'canvas:main',
          title: config.title ?? 'Untitled canvas',
        },
      })
      const disposeCanvasClient = consumer.provide('canvasClient', sync.canvasClient)
      try {
        await sync.start()
      } catch (error) {
        await disposeCanvasClient()
        await sync.dispose()
        throw error
      }

      let disposeCenter: (() => void) | undefined
      let disposeCanvases: (() => void) | undefined
      try {
        disposeCenter = consumer.slots.inject('workbench.center', () =>
          consumer.slots.register({
            name: 'workbench.center',
            inject: () => ({ workspace: sync.workspace }),
          }, CanvasCenter))
        disposeCanvases = consumer.slots.inject('project.canvases', () =>
          consumer.slots.register({
            name: 'project.canvases',
            inject: () => ({ workspace: sync.workspace, canvasProject: sync }),
          }, CanvasProjectCanvases))
      } catch (error) {
        disposeCanvases?.()
        disposeCenter?.()
        await disposeCanvasClient()
        await sync.dispose()
        throw error
      }

      return async () => {
        disposeCanvases?.()
        disposeCenter?.()
        await disposeCanvasClient()
        await sync.dispose()
      }
    })
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await disposeRemote()
  }
}
