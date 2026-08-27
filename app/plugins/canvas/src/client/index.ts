import type { Context } from '@deepseek-ai/cordis'
import {
  CanvasProjectBrowser,
  CanvasWorkbench,
  NewSessionAction,
  WorkbenchAgentPanel,
} from './Workbench.tsx'
import { CanvasRemoteSync, type CanvasRemoteApi } from './remote-sync.ts'
import { WorkbenchLayout } from './layout.ts'
import { TYPERT_REMOTE } from '../remote.ts'

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
  $mount(contribution: typeof TYPERT_REMOTE): Promise<() => void | Promise<void>>
  readonly canvas: CanvasRemoteApi
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

export const inject = ['slots', 'remote', 'workspaces']

/**
 * Replace only the documented root slot. Panel shells and contents are separate
 * slot contributions: the official DSH sidebar owns its chrome, Canvas occupies
 * sidebar.workspaces, and the Agent shell declares official conversation/details.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const layout = new WorkbenchLayout()
  const disposeLayout = ctx.reflect.provide('layout', layout)
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  await ctx.inject(['remote.canvas'], (canvasCtx) => {
    const consumer = canvasCtx as ClientContext
    const sync = new CanvasRemoteSync(consumer.remote.canvas)
    return sync.start().then(() => {
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
        inject: () => ({
          workspace: sync.workspace,
          layout,
        }),
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
        await sync.dispose()
      }
    })
  })
  return async () => {
    await disposeRemote()
    await disposeLayout()
    layout.dispose()
  }
}
