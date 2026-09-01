import type { Context } from '@deepseek-ai/cordis'
import type { TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { ComicProjectScope } from '../contracts.js'
import { PROJECT_FILES_REMOTE_CONTRIBUTION } from '../remote-contract.js'
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
  $mount(contribution: typeof PROJECT_FILES_REMOTE_CONTRIBUTION): Promise<() => void | Promise<void>>
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

type ScopeDisposer = () => void | Promise<void>

class ComicProjectScopeBinding {
  readonly #ctx: ClientContext
  #desired: ComicProjectScope | undefined
  #disposeCurrent: ScopeDisposer | undefined
  #revision = 0
  #appliedRevision = 0
  #task: Promise<void> | undefined
  #disposed = false

  constructor(ctx: ClientContext) {
    this.#ctx = ctx
  }

  request(scope: ComicProjectScope | undefined): void {
    if (this.#disposed || sameScope(scope, this.#desired)) return
    this.#desired = scope
    this.#revision += 1
    void this.#ensureDrain()
  }

  async flush(): Promise<void> {
    await this.#ensureDrain()
  }

  async dispose(): Promise<void> {
    if (!this.#disposed) {
      this.#disposed = true
      this.#desired = undefined
      this.#revision += 1
    }
    await this.#ensureDrain()
  }

  #ensureDrain(): Promise<void> {
    if (this.#task !== undefined) return this.#task
    const task = this.#drain().finally(() => {
      if (this.#task !== task) return
      this.#task = undefined
      if (this.#appliedRevision !== this.#revision) void this.#ensureDrain()
    })
    this.#task = task
    return task
  }

  async #drain(): Promise<void> {
    while (this.#appliedRevision !== this.#revision) {
      const revision = this.#revision
      const desired = this.#desired
      const disposeCurrent = this.#disposeCurrent
      this.#disposeCurrent = undefined
      await disposeCurrent?.()
      if (revision !== this.#revision) continue
      if (!this.#disposed && desired !== undefined) {
        this.#disposeCurrent = this.#ctx.provide('comicProject', desired)
      }
      this.#appliedRevision = revision
    }
  }
}

function sameScope(left: ComicProjectScope | undefined, right: ComicProjectScope | undefined): boolean {
  return left?.workspaceId === right?.workspaceId && left?.projectId === right?.projectId
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(PROJECT_FILES_REMOTE_CONTRIBUTION)
  try {
    await ctx.inject(['remote.projectFiles'], async (remoteCtx) => {
      const consumer = remoteCtx as ClientContext
      const activeRuntime = new ComicProjectRuntime(consumer.remote.projectFiles, consumer.workspaces, consumer.sessions)
      const layout = new ProjectLayout()
      const scopeBinding = new ComicProjectScopeBinding(consumer)
      let disposeLayout: ScopeDisposer | undefined
      let unsubscribeScope: (() => void) | undefined
      const disposers: Array<() => void> = []

      try {
        disposeLayout = consumer.reflect.provide('layout', layout)
        const syncScope = (): void => { scopeBinding.request(activeRuntime.scope()) }
        unsubscribeScope = activeRuntime.subscribe(syncScope)
        activeRuntime.start()
        syncScope()
        await scopeBinding.flush()

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
      } catch (error) {
        unsubscribeScope?.()
        await scopeBinding.dispose()
        for (const dispose of disposers.reverse()) dispose()
        await disposeLayout?.()
        await activeRuntime.dispose()
        layout.dispose()
        throw error
      }

      return async () => {
        unsubscribeScope?.()
        await scopeBinding.dispose()
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

  return async () => {
    await disposeRemote()
  }
}
