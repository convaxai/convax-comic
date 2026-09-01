import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFilesRemoteService } from '../src/remote.ts'

describe('Project files Remote service', () => {
  it('uses proxy-safe public state when Cordis invokes a service method', async () => {
    const manager = {
      open: vi.fn(async () => ({ leaseId: 'lease-1', workspaceId: 'workspace-1', sequence: 0 })),
      list: vi.fn(),
      read: vi.fn(async () => ({
        kind: 'text', path: 'README.md', name: 'README.md', size: 2,
        mimeType: 'text/markdown', text: 'hi',
      })),
      wait: vi.fn(),
      closeLease: vi.fn(),
    }
    const ctx = new Context()
    new ProjectFilesRemoteService(ctx, manager as never)
    const service = ctx.get('projectFilesRemote') as ProjectFilesRemoteService

    await expect(service.open({ workspaceId: 'workspace-1' })).resolves.toEqual({
      leaseId: 'lease-1', workspaceId: 'workspace-1', sequence: 0,
    })
    expect(manager.open).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    const signal = new AbortController().signal
    await expect(service.read({ workspaceId: 'workspace-1', path: 'README.md' }, signal)).resolves.toMatchObject({
      kind: 'text', path: 'README.md', text: 'hi',
    })
    expect(manager.read).toHaveBeenCalledWith({ workspaceId: 'workspace-1', path: 'README.md' }, signal)
    await ctx.fiber.dispose()
  })
})
