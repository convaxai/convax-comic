import { PROJECT_FILE_DRAG_MIME, encodeProjectFileDragPayload } from '@convax/project/contracts'
import { describe, expect, it } from 'vitest'
import { projectFilePathFromDrop } from '../src/client/CanvasView.tsx'

// Keep the Project tree reference protocol separate from Canvas node drops: it
// carries authority-free identity only and is revalidated against active scope.
describe('Canvas project file drop boundary', () => {
  it('accepts exact same-workspace relative references', () => {
    const value = encodeProjectFileDragPayload({ workspaceId: 'workspace-1', path: 'art/cover.png' })
    expect(PROJECT_FILE_DRAG_MIME).toBe('application/vnd.convax.project-file.v1+json')
    expect(projectFilePathFromDrop(value, 'workspace-1')).toBe('art/cover.png')
  })

  it('rejects stale-workspace and metadata-bearing references before Host reads', () => {
    const stale = encodeProjectFileDragPayload({ workspaceId: 'workspace-2', path: 'notes/beat.md' })
    expect(() => projectFilePathFromDrop(stale, 'workspace-1')).toThrow(/different workspace/u)
    expect(() => projectFilePathFromDrop(JSON.stringify({
      workspaceId: 'workspace-1', path: 'notes/beat.md', absolutePath: '/secret/beat.md',
    }), 'workspace-1')).toThrow(/fields/u)
  })
})
