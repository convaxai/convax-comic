import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { ComicProjectScope } from '../contracts.js'
import { TYPERT_PROJECT_FILES_REMOTE } from '../remote.js'
import type {} from '../remote.js'
import { ProjectLayout } from './layout.js'
import { ComicProjectRuntime, type SessionsLike, type WorkspacesLike } from './runtime.js'
import { NewSessionAction, ProjectNavigator, ProjectShell, WorkbenchAgentPanel } from './components.js'

export * from '../contracts.js'
export * from './layout.js'
export * from './runtime.js'
export * from './components.js'

interface SlotOptions {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly children?: Readonly<Record<string, { readonly kind: string; readonly scope: string }>>
  readonly inject?: () => Record<string, unknown>
}
interface Slots {
  inject(name: string, callback: () => unknown): () => void
  register(options: SlotOptions, component: unknown): () => void
}
interface Reflector {
  provide(name: string, service: unknown): () => void | Promise<void>
}
interface RemoteRoot {
  $mount(contribution: typeof TYPERT_PROJECT_FILES_REMOTE): Promise<() => void | Promise<void>>
  readonly projectFiles: TypertRemoteNamespaceMap['projectFiles']
}
type ClientContext = Context & {
  slots: Slots
  remote: RemoteRoot
  workspaces: WorkspacesLike
  sessions: SessionsLike
  reflect: Reflector
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    comicProject: ComicProjectScope
  }
}

export const inject = ['slots', 'remote', 'workspaces', 'sessions']

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_PROJECT_FILES_REMOTE)
  let runtime: ComicProjectRuntime | undefined
  try {
    await ctx.inject(['remote.projectFiles'], async (remoteCtx) => {
      const consumer = remoteCtx as ClientContext
      const activeRuntime = new ComicProjectRuntime(consumer.remote.projectFiles, consumer.workspaces, consumer.sessions)
      const layout = new ProjectLayout()
      let disposeLayout: (() => void | Promise<void>) | undefined
      const disposers: Array<() => void> = []

      try {
        disposeLayout = consumer.reflect.provide('layout', layout)
        activeRuntime.start()

        disposers.push(consumer.slots.register({
          name: 'root',
          children: {
            sidebar: { kind: 'single', scope: 'root' },
            'workbench.center': { kind: 'single', scope: 'root' },
            'workbench.agent': { kind: 'single', scope: 'root' },
            'shell.overlay': { kind: 'list', scope: 'root' },
          },
          inject: () => ({ runtime: activeRuntime, layout }),
        }, ProjectShell))
        disposers.push(consumer.slots.inject('sidebar.workspaces', () => consumer.slots.register({
          name: 'sidebar.workspaces',
          children: { 'project.canvases': { kind: 'single', scope: 'root' } },
          inject: () => ({ runtime: activeRuntime }),
        }, ProjectNavigator)))
        disposers.push(consumer.slots.inject('workbench.agent', () => consumer.slots.register({
          name: 'workbench.agent',
          children: {
            conversation: { kind: 'single', scope: 'session' },
            details: { kind: 'single', scope: 'session' },
            'workbench.agent.header.action': { kind: 'list', scope: 'root' },
          },
        }, WorkbenchAgentPanel)))
        disposers.push(consumer.slots.inject('workbench.agent.header.action', () => consumer.slots.register({
          name: 'workbench.agent.header.action', id: 'app-project-new-session', order: 100,
          inject: () => ({ runtime: activeRuntime }),
        }, NewSessionAction)))
        runtime = activeRuntime
      } catch (error) {
        for (const dispose of disposers.reverse()) dispose()
        await disposeLayout?.()
        await activeRuntime.dispose()
        layout.dispose()
        throw error
      }

      return async () => {
        for (const dispose of disposers.reverse()) dispose()
        await disposeLayout?.()
        await activeRuntime.dispose()
        layout.dispose()
      }
    })
  } catch (error) {
    await disposeRemote()
    throw error
  }

  if (runtime === undefined) {
    await disposeRemote()
    throw new Error('project files Remote activated without a Client runtime')
  }

  const activeRuntime = runtime
  let scopeWorkspaceId: string | undefined
  let disposeScope: (() => void | Promise<void>) | undefined
  const syncScope = (): void => {
    const scope = activeRuntime.scope()
    if (scope?.workspaceId === scopeWorkspaceId) return
    scopeWorkspaceId = scope?.workspaceId
    if (scope === undefined) {
      const previous = disposeScope
      disposeScope = undefined
      if (previous !== undefined) void Promise.resolve(previous())
    } else if (disposeScope === undefined) {
      disposeScope = ctx.provide('comicProject', scope)
    } else {
      ctx.set('comicProject', scope)
    }
  }
  const unsubscribeScope = activeRuntime.subscribe(syncScope)
  syncScope()

  return async () => {
    unsubscribeScope()
    await disposeScope?.()
    await disposeRemote()
  }
}
