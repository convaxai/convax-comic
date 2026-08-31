import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFilesRemoteService } from '../src/remote.ts'

describe('Project files Remote service', () => {
  it('uses proxy-safe public state when Cordis invokes a service method', async () => {
    const manager = {
      open: vi.fn(async () => ({ leaseId: 'lease-1', workspaceId: 'workspace-1', sequence: 0 })),
      list: vi.fn(),
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
    await ctx.fiber.dispose()
  })
})
