import { describe, expect, it } from 'vitest'
import {
  CanvasStoreError,
  CanvasStoreRevisionConflict,
  type CommitCanvasProjectInput,
  type DeleteCanvasProjectInput,
  type StoredCanvasProject,
} from '../src/index.ts'

describe('CanvasStore contract', () => {
  it('publishes stable conflict diagnostics', () => {
    const error = new CanvasStoreRevisionConflict(2, 3)
    expect(error).toBeInstanceOf(CanvasStoreError)
    expect(error).toMatchObject({ code: 'CONFLICT', expected: 2, actual: 3 })
    expect(error.message).toContain('expected 2, current 3')
  })

  it('makes workspace identity explicit on stored rows and mutations', () => {
    const stored: StoredCanvasProject = {
      workspaceId: 'workspace:a',
      projectId: 'project:shared',
      revision: 2,
      projectJson: '{}',
    }
    const commit: CommitCanvasProjectInput = {
      workspaceId: stored.workspaceId,
      projectId: stored.projectId,
      expectedRevision: stored.revision,
      projectJson: '{"revision":3}',
    }
    const deletion: DeleteCanvasProjectInput = {
      workspaceId: stored.workspaceId,
      projectId: stored.projectId,
      expectedRevision: stored.revision,
    }
    expect({ stored, commit, deletion }).toMatchObject({
      stored: { workspaceId: 'workspace:a' },
      commit: { workspaceId: 'workspace:a' },
      deletion: { workspaceId: 'workspace:a' },
    })
  })
})
