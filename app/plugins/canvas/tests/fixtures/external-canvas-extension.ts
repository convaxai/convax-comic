import type { Context } from '@deepseek-ai/cordis'
import type { CanvasNodeRenderer } from '@convax/canvas-api'

export const EXTERNAL_NODE_TYPE = 'example.external-card'
export const EXTERNAL_KIND_VERSION = 1

/** Deliberately lives outside Canvas src/ and depends only on the public Contract. */
export const ExternalCanvasHostExtension = {
  inject: ['canvasHost'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.canvasHost.registerNodeType({
      type: EXTERNAL_NODE_TYPE,
      kindVersion: EXTERNAL_KIND_VERSION,
      createData: () => ({ label: '' }),
      validateData: (data: unknown): data is { label: string } => typeof data === 'object'
        && data !== null
        && !Array.isArray(data)
        && typeof (data as { label?: unknown }).label === 'string',
    }), 'external-canvas-host-type')
  },
}

export function externalCanvasClientExtension(renderer: CanvasNodeRenderer) {
  return {
    inject: ['canvasClient'],
    apply(ctx: Context) {
      ctx.effect(() => ctx.canvasClient.renderers.registerNode({
        type: EXTERNAL_NODE_TYPE,
        kindVersion: EXTERNAL_KIND_VERSION,
        renderer,
      }), 'external-canvas-client-renderer')
    },
  }
}
