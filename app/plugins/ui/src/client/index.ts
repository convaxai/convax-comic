import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '@convax/beui/styles'
import type { Context } from '@deepseek-ai/cordis'
import type { ThemeRuntime, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
import React from 'react'

interface SlotRegistry {
  inject(name: string, callback: () => unknown): unknown
  register(
    options: { name: string; id?: string; order?: number },
    component: React.ComponentType<Record<string, unknown>>,
  ): unknown
}

type ClientContext = Context & {
  slots: SlotRegistry
  theme: Pick<ThemeRuntime, 'overrideTokens'>
}

const BEUI_THEME_TOKENS = {
  '--dsw-alias-bg-base': { light: '#f7f8f6', dark: '#11140f' },
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#181c16' },
  '--dsw-alias-bg-layer-2': { light: '#f1f2ee', dark: '#20251d' },
  '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#252a22' },
  '--dsw-alias-border-l1': { light: '#e3e6df', dark: '#30372c' },
  '--dsw-alias-border-l2': { light: '#ced3ca', dark: '#424b3c' },
  '--dsw-alias-brand-primary': { light: '#5f7f00', dark: '#c6f22d' },
  '--dsw-alias-label-primary': { light: '#171a17', dark: '#f1f4ec' },
  '--dsw-alias-label-secondary': { light: '#697069', dark: '#aeb7a8' },
  '--dsw-alias-state-error-primary': { light: '#dc2626', dark: '#fb7185' },
  '--dsw-alias-state-success-primary': { light: '#16a34a', dark: '#4ade80' },
  '--dsw-alias-state-warn-primary': { light: '#d97706', dark: '#fbbf24' },
  '--dsw-specific-sidebar-fill': { light: '#f1f2ee', dark: '#181c16' },
} satisfies ThemeTokenOverrides

function ConvaxBeuiStyles(): React.ReactElement {
  return React.createElement('style', { 'data-convax-beui': true }, `${BEUI_THEME_CSS}\n${BEUI_COMPONENT_CSS}`)
}

function ConvaxComicMark(props: Record<string, unknown>): React.ReactElement {
  const size = typeof props.size === 'number' ? props.size : 24
  return React.createElement('span', {
    'aria-label': 'Convax Comic',
    className: typeof props.className === 'string' ? props.className : undefined,
    style: {
      alignItems: 'center',
      background: 'var(--dsw-alias-brand-primary)',
      borderRadius: Math.max(6, Math.round(size * 0.28)),
      color: 'var(--dsw-alias-bg-layer-1)',
      display: 'inline-flex',
      fontSize: Math.max(10, Math.round(size * 0.5)),
      fontWeight: 800,
      height: size,
      justifyContent: 'center',
      width: size,
    },
  }, 'C')
}

function ConvaxComicName(): React.ReactElement {
  return React.createElement('span', { style: { fontWeight: 700, letterSpacing: '-0.02em' } }, 'Convax Comic')
}

export const inject = ['slots', 'theme']

export function apply(ctx: ClientContext): void {
  ctx.effect(
    () => ctx.theme.overrideTokens('convax-beui', BEUI_THEME_TOKENS),
    'convax-beui: theme token overrides',
  )

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'app-ui-beui-styles', order: -1_000 }, ConvaxBeuiStyles))

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ConvaxComicMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, ConvaxComicName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ConvaxComicMark)
      })))
}
