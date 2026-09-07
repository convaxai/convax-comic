import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFilesRemoteService } from '../src/remote.ts'
import { PROJECT_FILES_RESULT_SCHEMAS } from '../src/remote-contract.ts'

describe('Project files Remote service', () => {
  it('keeps authenticated video media leases on the preview-only result contract', () => {
    const video = {
      kind: 'video', path: 'clip.mp4', name: 'clip.mp4', size: 12,
      mimeType: 'video/mp4', previewId: 'preview-1', mediaUrl: '/convax/project-media/preview-1',
    }
    expect(PROJECT_FILES_RESULT_SCHEMAS.preview.safeParse(video).success).toBe(true)
    expect(PROJECT_FILES_RESULT_SCHEMAS.read.safeParse(video).success).toBe(false)
  })

  it('uses proxy-safe public state when Cordis invokes a service method', async () => {
    const manager = {
      open: vi.fn(async () => ({ leaseId: 'lease-1', workspaceId: 'workspace-1', sequence: 0 })),
      list: vi.fn(),
      read: vi.fn(async () => ({
        kind: 'text', path: 'README.md', name: 'README.md', size: 2,
        mimeType: 'text/markdown', text: 'hi',
      })),
      preview: vi.fn(async () => ({
        kind: 'video', path: 'clip.mp4', name: 'clip.mp4', size: 12,
        mimeType: 'video/mp4', previewId: 'preview-1', mediaUrl: '/convax/project-media/preview-1',
      })),
      releasePreview: vi.fn(async () => ({ released: true })),
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
    await expect(service.preview({ workspaceId: 'workspace-1', path: 'clip.mp4' }, signal)).resolves.toMatchObject({
      kind: 'video', path: 'clip.mp4', mimeType: 'video/mp4',
    })
    expect(manager.preview).toHaveBeenCalledWith({ workspaceId: 'workspace-1', path: 'clip.mp4' }, signal)
    await expect(service.releasePreview({ previewId: 'preview-1' })).resolves.toEqual({ released: true })
    expect(manager.releasePreview).toHaveBeenCalledWith('preview-1')
    await ctx.fiber.dispose()
  })
})
