import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '@convax/beui/styles'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import React from 'react'
import {
  ConvaxSettingsRoot,
  SETTINGS_MESSAGES,
  SETTINGS_NAMESPACE,
  SettingsCloseLabel,
  SettingsDocumentAction,
  SettingsDocumentController,
  SettingsGeneralSection,
  SettingsHeaderContent,
  SettingsTriggerContent,
  type SettingsSectionRow,
  type SettingsTranslate,
  type SnapshotSource,
} from './settings.js'
import { CONVAX_SETTINGS_CSS } from './settings-styles.js'
import { ConvaxThemePresenter } from './theme-presenter.js'

interface SlotOptions {
  readonly name: string
  readonly id?: string
  readonly order?: number
  readonly priority?: number
  readonly label?: string | (() => string)
  readonly locale?: string
  readonly children?: Readonly<Record<string, { readonly kind: string; readonly scope: string }>>
  readonly inject?: () => Record<string, unknown>
}

interface SlotEntry {
  readonly options: {
    readonly id?: string
    readonly order?: number
    readonly label?: string | (() => string)
  }
}

interface SlotRegistry {
  inject(name: string, callback: () => unknown): unknown
  register(options: SlotOptions, component: unknown): unknown
  entries(name: string): readonly SlotEntry[]
  getVersion(name: string): number
  subscribe(name: string, listener: () => void): () => void
}

type ClientContext = Context & {
  slots: SlotRegistry
  theme: Pick<ThemeRuntime, 'getTheme'>
  locale: Pick<LocaleRuntime, 'bind' | 'getSnapshot' | 'register' | 'subscribe'>
  connection: ConnectionHandle
  settingsScope: Pick<SettingsScopeBinder, 'describe'>
}

function ConvaxBeuiStyles(): React.ReactElement {
  return React.createElement(
    'style',
    { 'data-convax-beui': true },
    `${BEUI_THEME_CSS}\n${BEUI_COMPONENT_CSS}\n${CONVAX_SETTINGS_CSS}`,
  )
}

function ConvaxComicMark(props: Record<string, unknown>): React.ReactElement {
  const size = typeof props.size === 'number' ? props.size : 24
  return React.createElement('span', {
    'aria-label': 'Convax Comic',
    className: typeof props.className === 'string' ? props.className : undefined,
    style: {
      alignItems: 'center',
      background: 'var(--cvx-beui-primary)',
      borderRadius: Math.max(6, Math.round(size * 0.28)),
      color: 'var(--cvx-beui-primary-foreground)',
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

function resolveLabel(label: SlotEntry['options']['label']): string {
  if (typeof label === 'function') return label()
  return label ?? ''
}

function createSettingsSources(ctx: ClientContext): {
  readonly sections: SnapshotSource<readonly SettingsSectionRow[]>
} {
  let rowsVersion = -1
  let rowsRevision = -1
  let rows: readonly SettingsSectionRow[] = []

  const sections: SnapshotSource<readonly SettingsSectionRow[]> = {
    getSnapshot: () => {
      const version = ctx.slots.getVersion('settings.section')
      const revision = ctx.locale.getSnapshot().revision
      if (version !== rowsVersion || revision !== rowsRevision) {
        rowsVersion = version
        rowsRevision = revision
        rows = ctx.slots.entries('settings.section')
          .map(entry => ({
            id: entry.options.id ?? '',
            order: entry.options.order ?? 0,
            label: resolveLabel(entry.options.label),
          }))
          .sort((left, right) => left.order - right.order)
      }
      return rows
    },
    subscribe: (listener) => {
      const offSlots = ctx.slots.subscribe('settings.section', listener)
      const offLocale = ctx.locale.subscribe(listener)
      return () => {
        offLocale()
        offSlots()
      }
    },
  }

  return { sections }
}

export const inject = ['slots', 'theme', 'locale', 'connection', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => undefined
    const presenter = new ConvaxThemePresenter(document)
    presenter.apply(ctx.theme.getTheme())
    const offTheme = ctx.on('theme/change', snapshot => { presenter.apply(snapshot) })
    return () => {
      offTheme()
      presenter.dispose()
    }
  }, 'convax-beui: theme presenter')

  ctx.effect(() => {
    const offZh = ctx.locale.register(SETTINGS_NAMESPACE, 'zh', SETTINGS_MESSAGES.zh)
    const offEn = ctx.locale.register(SETTINGS_NAMESPACE, 'en', SETTINGS_MESSAGES.en)
    return () => {
      offEn()
      offZh()
    }
  }, 'convax-settings: dictionaries')

  const t = ctx.locale.bind(SETTINGS_NAMESPACE) as SettingsTranslate
  const sources = createSettingsSources(ctx)
  const documentController = ctx.connection.isLoopback
    ? new SettingsDocumentController(ctx.connection.api, ctx.settingsScope.describe())
    : undefined

  ctx.effect(() => () => { documentController?.dispose() }, 'convax-settings: document action')

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'app-ui-beui-styles', order: -1_000 }, ConvaxBeuiStyles))

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, ConvaxComicMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, ConvaxComicName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, ConvaxComicMark)
      })))

  ctx.slots.inject('sidebar.settings', () => ctx.slots.register({
    name: 'sidebar.settings',
    locale: SETTINGS_NAMESPACE,
    children: {
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
    inject: () => sources,
  }, ConvaxSettingsRoot))

  ctx.slots.inject('settings.trigger', () => ctx.slots.register({
    name: 'settings.trigger',
    locale: SETTINGS_NAMESPACE,
  }, SettingsTriggerContent))
  ctx.slots.inject('settings.header', () => ctx.slots.register({
    name: 'settings.header',
    locale: SETTINGS_NAMESPACE,
  }, SettingsHeaderContent))
  ctx.slots.inject('settings.close', () => ctx.slots.register({
    name: 'settings.close',
    locale: SETTINGS_NAMESPACE,
  }, SettingsCloseLabel))

  if (documentController !== undefined) {
    ctx.slots.inject('settings.action', () => ctx.slots.register({
      name: 'settings.action',
      id: 'app-ui-open-document',
      order: 0,
      locale: SETTINGS_NAMESPACE,
      inject: () => ({ controller: documentController }),
    }, SettingsDocumentAction))
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'general',
    order: 0,
    label: () => t('general.nav'),
    children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, SettingsGeneralSection))
}

export {
  ConvaxSettingsRoot,
  ConvaxThemePresenter,
  SETTINGS_MESSAGES,
  SETTINGS_NAMESPACE,
  SettingsDocumentController,
  SettingsGeneralSection,
}
