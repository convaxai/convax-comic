import type {
  CanvasClientApi,
  CanvasEdgeRendererProps,
  CanvasNodeRendererProps,
  CanvasRendererRegistry,
} from '@convax/canvas-api'
import type { Context } from '@deepseek-ai/cordis'
import { createElement, type ChangeEvent, type ReactElement } from 'react'
import {
  COMIC_BUILTIN_KIND_VERSION,
  COMIC_IMAGE_NODE_TYPE,
  COMIC_NOTE_NODE_TYPE,
  COMIC_SEQUENCE_EDGE_TYPE,
  type ComicImageData,
  type ComicNoteData,
  type ComicSequenceData,
} from '../contracts.js'

export * from '../contracts.js'

export type ResolveComicAssetUrl = (assetId: string) => string | undefined

export interface Config {
  resolveAssetUrl?: ResolveComicAssetUrl
}

export const name = 'app-canvas-builtins/client'
export const inject = ['canvasClient']

export function ComicNoteRenderer(props: CanvasNodeRendererProps<ComicNoteData>): ReactElement {
  return createElement('textarea', {
    'aria-label': props.node.data.title || 'Note',
    value: props.node.data.text,
    onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      void props.actions.update({ data: { text: event.currentTarget.value } })
    },
    style: {
      boxSizing: 'border-box',
      width: '100%',
      height: '100%',
      resize: 'none',
      border: 0,
      outline: 0,
      background: 'transparent',
      color: 'inherit',
      font: 'inherit',
    },
  })
}

export function createComicImageRenderer(resolveAssetUrl?: ResolveComicAssetUrl) {
  return function ComicImageRenderer(props: CanvasNodeRendererProps<ComicImageData>): ReactElement {
    const source = props.node.data.source
    const src = source.type === 'url' ? source.url : resolveAssetSafely(resolveAssetUrl, source.assetId)
    if (src === undefined || src.length === 0) {
      return createElement('div', {
        role: 'img',
        'aria-label': props.node.data.alt || props.node.data.title || 'Unavailable image',
        'data-canvas-image-unavailable': source.type,
      }, 'Image unavailable')
    }
    return createElement('img', {
      src,
      alt: props.node.data.alt,
      draggable: false,
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        pointerEvents: 'none',
      },
    })
  }
}

export function ComicSequenceRenderer(props: CanvasEdgeRendererProps<ComicSequenceData>): ReactElement {
  return createElement(
    'g',
    { 'data-canvas-sequence-edge': props.edge.id },
    createElement('title', undefined, props.edge.data.label || 'Sequence'),
  )
}

export function registerComicBuiltinRenderers(
  registry: CanvasRendererRegistry,
  resolveAssetUrl?: ResolveComicAssetUrl,
): () => void {
  const disposers: Array<() => void> = []
  try {
    disposers.push(registry.registerNode({
      type: COMIC_NOTE_NODE_TYPE,
      kindVersion: COMIC_BUILTIN_KIND_VERSION,
      renderer: ComicNoteRenderer,
    }))
    disposers.push(registry.registerNode({
      type: COMIC_IMAGE_NODE_TYPE,
      kindVersion: COMIC_BUILTIN_KIND_VERSION,
      renderer: createComicImageRenderer(resolveAssetUrl),
    }))
    disposers.push(registry.registerEdge({
      type: COMIC_SEQUENCE_EDGE_TYPE,
      kindVersion: COMIC_BUILTIN_KIND_VERSION,
      renderer: ComicSequenceRenderer,
    }))
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

export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(
    () => registerComicBuiltinRenderers(ctx.canvasClient.renderers, config.resolveAssetUrl),
    'canvas-builtins/client-registrations',
  )
}

function resolveAssetSafely(resolveAssetUrl: ResolveComicAssetUrl | undefined, assetId: string): string | undefined {
  try {
    return resolveAssetUrl?.(assetId)
  } catch {
    return undefined
  }
}

function disposeReverse(disposers: Array<() => void>): void {
  for (const dispose of disposers.reverse()) dispose()
}

export type CanvasBuiltinsClientService = CanvasClientApi
