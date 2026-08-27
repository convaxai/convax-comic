import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { CANVAS_REMOTE_CONTRIBUTION, type CanvasWireSnapshot, type CanvasWireSummary } from './remote-contract.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'canvas/read': () => Promise<RemoteResult<CanvasWireSnapshot>>
    'canvas/replace': (documentJson: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
    'canvas/create': (title: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
    'canvas/select': (canvasId: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
  }

  interface TypertRemoteNamespaceMap {
    canvas: {
      read: () => Promise<RemoteResult<CanvasWireSnapshot>>
      replace: (documentJson: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
      create: (title: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
      select: (canvasId: string, expectedRevision: number) => Promise<RemoteResult<CanvasWireSnapshot>>
    }
  }
}

export const TYPERT_REMOTE = CANVAS_REMOTE_CONTRIBUTION
export default TYPERT_REMOTE
export type { CanvasWireSnapshot, CanvasWireSummary }
