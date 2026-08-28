import { describe, expect, it } from 'vitest'
import {
  CANVAS_CLIENT_SERVICE,
  CANVAS_COMMITTED_EVENT,
  CANVAS_HOST_SERVICE,
  classifyCanvasCommittedEvent,
  type CanvasCommittedEvent,
} from '../src/index.ts'

function event(revision: number, overrides: Partial<CanvasCommittedEvent> = {}): CanvasCommittedEvent {
  return {
    workspaceId: 'workspace-comic',
    projectId: 'project-story',
    canvasId: 'canvas-main',
    revision,
    mutationId: `mutation-${revision}`,
    source: 'test',
    operations: [],
    ...overrides,
  }
}

describe('Canvas committed event classification', () => {
  it('exports stable service and event names', () => {
    expect(CANVAS_HOST_SERVICE).toBe('canvasHost')
    expect(CANVAS_CLIENT_SERVICE).toBe('canvasClient')
    expect(CANVAS_COMMITTED_EVENT).toBe('canvas/committed')
  })

  it('applies exactly the next revision', () => {
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 4, event(5))).toBe('applied')
  })

  it('classifies current and older revisions as duplicates', () => {
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 5, event(5))).toBe('duplicate')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 5, event(3))).toBe('duplicate')
  })

  it('requires refresh for gaps, identity mismatches, and invalid revisions', () => {
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 2, event(4))).toBe('refresh-required')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 2, event(3, { workspaceId: 'other' }))).toBe('refresh-required')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 2, event(3, { projectId: 'other' }))).toBe('refresh-required')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 2, event(3, { canvasId: 'other' }))).toBe('refresh-required')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', -1, event(0))).toBe('refresh-required')
    expect(classifyCanvasCommittedEvent('workspace-comic', 'project-story', 'canvas-main', 2, event(Number.NaN))).toBe('refresh-required')
  })
})
