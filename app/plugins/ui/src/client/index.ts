import type { Context } from '@deepseek-ai/cordis'
import React from 'react'

interface SlotRegistry {
  inject(name: string, callback: () => unknown): unknown
  register(options: { name: string }, component: React.ComponentType<Record<string, unknown>>): unknown
}

type ClientContext = Context & { slots: SlotRegistry }

function ConvaxMark(props: Record<string, unknown>): React.ReactElement {
  const size = typeof props.size === 'number' ? props.size : 24
  return React.createElement('span', {
    'aria-label': 'Convax',
    className: typeof props.className === 'string' ? props.className : undefined,
    style: {
      alignItems: 'center',
      background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
      borderRadius: Math.max(6, Math.round(size * 0.3)),
      color: '#fff',
      display: 'inline-flex',
      fontSize: Math.max(10, Math.round(size * 0.5)),
      fontWeight: 800,
      height: size,
      justifyContent: 'center',
      width: size,
    },
  }, 'C')
}

function ConvaxName(): React.ReactElement {
  return React.createElement('span', { style: { fontWeight: 700, letterSpacing: '-0.02em' } }, 'Convax')
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ConvaxMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, ConvaxName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ConvaxMark)
      })))
}
