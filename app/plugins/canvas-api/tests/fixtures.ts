import type { CanvasDocument, CanvasEdge, CanvasNode, CanvasProject } from '../src/index.ts'

export function createNode(id: string, x = 0): CanvasNode {
  return {
    id,
    type: 'panel',
    kindVersion: 1,
    position: { x, y: 20 },
    zIndex: 0,
    style: { width: 320, height: 180, color: 'ink' },
    data: { caption: `Node ${id}`, nested: { visible: true }, tags: ['comic', 'panel'] },
  }
}

export function createEdge(id: string, source = 'node-a', target = 'node-b'): CanvasEdge {
  return {
    id,
    source,
    target,
    type: 'sequence',
    kindVersion: 1,
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { label: 'next', weight: 1 },
  }
}

export function createDocument(): CanvasDocument {
  return {
    schemaVersion: 2,
    revision: 7,
    id: 'canvas-main',
    workspaceId: 'workspace-comic',
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:01:00.000Z',
    metadata: { title: 'Chapter 1' },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b', 400),
    },
    edges: {
      'edge-a-b': createEdge('edge-a-b'),
    },
  }
}

export function createProject(): CanvasProject {
  return {
    schemaVersion: 2,
    revision: 3,
    id: 'project-story',
    workspaceId: 'workspace-comic',
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T10:02:00.000Z',
    metadata: { title: 'My Comic' },
    activeCanvasId: 'canvas-main',
    canvases: { 'canvas-main': createDocument() },
  }
}
