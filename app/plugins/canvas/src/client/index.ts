import type { Context } from '@deepseek-ai/cordis'
import {
  CanvasProjectBrowser,
  CanvasWorkbench,
  NewSessionAction,
  WorkbenchAgentPanel,
} from './Workbench.js'
import {
  CanvasProjectSync,
  type CanvasRemoteV2Api,
} from './project-sync-v2.js'
import { WorkbenchLayout } from './layout.js'
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

interface ClientWorkspaces {
  readonly list: {
    getSnapshot(): {
      readonly items: readonly { readonly workspaceId: string }[]
      readonly recentWorkspaceId?: string
    }
  }
  startSession(workspaceId?: string): void
}

type ClientContext = Context & {
  slots: SlotRegistry
  remote: ClientRemoteRoot
  workspaces: ClientWorkspaces
}

export interface Config {
  readonly workspaceId?: string
  readonly projectId?: string
}

export const inject = ['slots', 'remote', 'workspaces']

/**
 * Mount the V2 Remote/Client object layer, then replace only the documented
 * root slot. Official conversation/details continue to own their panel content.
 */
export async function apply(ctx: ClientContext, config: Config = {}): Promise<() => Promise<void>> {
  const layout = new WorkbenchLayout()
  const disposeLayout = ctx.reflect.provide('layout', layout)
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE_V2)
  await ctx.inject(['remote.canvasV2'], async (canvasCtx) => {
    const consumer = canvasCtx as ClientContext
    const sync = new CanvasProjectSync(consumer.remote.canvasV2, {
      workspaceId: config.workspaceId ?? 'workspace:default',
      projectId: config.projectId ?? 'project:default',
      workspace: { initiallyOpen: true },
    })
    const disposeCanvasClient = consumer.reflect.provide('canvasClient', sync.canvasClient)
    try {
      await sync.start()
    } catch (error) {
      await disposeCanvasClient()
      await sync.dispose()
      throw error
    }

    const startSession = (): void => {
      const snapshot = consumer.workspaces.list.getSnapshot()
      consumer.workspaces.startSession(snapshot.recentWorkspaceId ?? snapshot.items[0]?.workspaceId)
    }
    const disposeRoot = consumer.slots.register({
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        'workbench.agent': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      inject: () => ({ workspace: sync.workspace, layout }),
    }, CanvasWorkbench)
    const disposeProjectBrowser = consumer.slots.inject('sidebar.workspaces', () =>
      consumer.slots.register({
        name: 'sidebar.workspaces',
        inject: () => ({ workspace: sync.workspace, project: sync }),
      }, CanvasProjectBrowser))
    const disposeAgentPanel = consumer.slots.inject('workbench.agent', () => {
      const disposePanel = consumer.slots.register({
        name: 'workbench.agent',
        children: {
          conversation: { kind: 'single', scope: 'session-maybe' },
          details: { kind: 'single', scope: 'session' },
          'workbench.agent.header.action': { kind: 'list', scope: 'root' },
        },
      }, WorkbenchAgentPanel)
      const disposeHeaderAction = consumer.slots.inject('workbench.agent.header.action', () =>
        consumer.slots.register({
          name: 'workbench.agent.header.action',
          id: 'app-canvas-new-session',
          order: 100,
          label: '新建对话',
          inject: () => ({ startSession }),
        }, NewSessionAction))
      return () => {
        disposeHeaderAction()
        disposePanel()
      }
    })
    return async () => {
      disposeAgentPanel()
      disposeProjectBrowser()
      disposeRoot()
      await disposeCanvasClient()
      await sync.dispose()
    }
  })
  return async () => {
    await disposeRemote()
    await disposeLayout()
    layout.dispose()
  }
}
