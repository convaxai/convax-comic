import type { CanvasHostApi } from '@convax/canvas-api'
import type { Context } from '@deepseek-ai/cordis'
import {
  comicImageNodeType,
  comicNoteNodeType,
  comicSequenceEdgeType,
} from './contracts.js'

export * from './contracts.js'

export const name = 'app-canvas-builtins'
export const inject = ['canvasHost']

export function registerComicBuiltinTypes(canvasHost: CanvasHostApi): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(canvasHost.registerNodeType(comicNoteNodeType))
    disposers.push(canvasHost.registerNodeType(comicImageNodeType))
    disposers.push(canvasHost.registerEdgeType(comicSequenceEdgeType))
  } catch (error) {
    disposeReverse(disposers)
    throw error
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    disposeReverse(disposers)
  }
}

export function apply(ctx: Context): void {
  ctx.effect(
    () => registerComicBuiltinTypes(ctx.canvasHost),
    'canvas-builtins/host-registrations',
  )
}

function disposeReverse(disposers: Array<() => void>): void {
  for (const dispose of disposers.reverse()) dispose()
}
