import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { PROJECT_VIDEO_MEDIA_ROUTE } from './contracts.js'
import { ProjectFilesManager, type ProjectFileSystem, type ProjectFsTarget } from './host/project-files.js'
import { ProjectFilesRemoteService } from './remote.js'
import { PROJECT_FILES_HOST_CONTRIBUTION } from './remote-contract.js'

export * from './contracts.js'
export * from './host/project-files.js'
export * from './remote.js'
export * from './remote-contract.js'

interface TypertRegistry {
  register(contribution: typeof PROJECT_FILES_HOST_CONTRIBUTION): () => void
}

interface ProjectWebServer {
  register(route: {
    readonly kind: 'prefix'
    readonly path: string
    readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

type HostContext = Context & {
  fs: ProjectFileSystem
  workspaceRegistry: WorkspaceRegistry
  typert: TypertRegistry
  webServer: ProjectWebServer
}

export const name = 'app-project'
export const inject = ['workspaceRegistry', 'fs', 'typert', 'webServer']

export function apply(ctx: HostContext): void {
  const manager = new ProjectFilesManager(ctx, ctx.fs, ctx.workspaceRegistry)
  ctx.effect(() => async () => { await manager.dispose() }, 'project-files watcher lifecycle')
  ctx.effect(() => ctx.typert.register(PROJECT_FILES_HOST_CONTRIBUTION), 'project-files Typert schemas')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PROJECT_VIDEO_MEDIA_ROUTE,
    handler: (request, response) => manager.serveVideoPreview(request, response),
  }), 'project video preview media route')
  new ProjectFilesRemoteService(ctx, manager)
  const onFsObserved = ctx.on as unknown as (
    event: 'fs/observed',
    listener: (target: ProjectFsTarget, observation: unknown, actor: object | undefined) => void,
  ) => () => void
  onFsObserved.call(ctx, 'fs/observed', (target, _observation, actor) => {
    manager.observeTarget(target, actor)
  })
}
