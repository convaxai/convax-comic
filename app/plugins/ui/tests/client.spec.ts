import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, SETTINGS_MESSAGES, SETTINGS_NAMESPACE } from '../src/client/index.ts'
import { CONVAX_SETTINGS_CSS } from '../src/client/settings-styles.ts'

const clientSource = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')

describe('Convax Comic BeUI client foundation', () => {
  it('registers the localized BeUI settings shell, styles, brands, and theme layer', () => {
    const registrations: Array<Record<string, unknown>> = []
    const effectDisposers: Array<() => void> = []
    const disposeZh = vi.fn()
    const disposeEn = vi.fn()
    const localeRegister = vi.fn((namespace: string, locale: string) => {
      expect(namespace).toBe(SETTINGS_NAMESPACE)
      return locale === 'zh' ? disposeZh : disposeEn
    })
    const slots = {
      inject(_name: string, callback: () => unknown): unknown {
        const result = callback()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
          return [...result as Iterable<unknown>]
        }
        return result
      },
      register(options: Record<string, unknown>): () => void {
        registrations.push(options)
        return () => undefined
      },
      entries: vi.fn(() => []),
      getVersion: vi.fn(() => 0),
      subscribe: vi.fn(() => () => undefined),
    }

    apply({
      effect(callback: () => (() => void)): void {
        const dispose = callback()
        if (typeof dispose === 'function') effectDisposers.push(dispose)
      },
      on: vi.fn(() => () => undefined),
      slots,
      theme: {
        getTheme: vi.fn(),
      },
      locale: {
        register: localeRegister,
        bind: vi.fn(() => (key: string) => key),
        getSnapshot: vi.fn(() => ({ revision: 0 })),
        subscribe: vi.fn(() => () => undefined),
      },
      connection: {
        isLoopback: true,
        api: { settings: { openDocument: vi.fn() } },
      },
      settingsScope: {
        describe: vi.fn(() => ({
          getSnapshot: () => ({ view: undefined, error: null }),
          subscribe: () => () => undefined,
          ensure: async () => undefined,
        })),
      },
    } as never)

    expect(inject).toEqual(['slots', 'theme', 'locale', 'connection', 'settingsScope'])
    expect(registrations.map(options => ({ name: options.name, id: options.id }))).toEqual([
      { name: 'shell.overlay', id: 'app-ui-beui-styles' },
      { name: 'sidebar.brand.mark', id: undefined },
      { name: 'sidebar.brand.name', id: undefined },
      { name: 'conversation.hero.brand.mark', id: undefined },
      { name: 'sidebar.settings', id: undefined },
      { name: 'settings.trigger', id: undefined },
      { name: 'settings.header', id: undefined },
      { name: 'settings.close', id: undefined },
      { name: 'settings.action', id: 'app-ui-open-document' },
      { name: 'settings.section', id: 'general' },
    ])
    expect(registrations[4]?.children).toEqual({
      'settings.trigger': { kind: 'single', scope: 'root' },
      'settings.header': { kind: 'single', scope: 'root' },
      'settings.action': { kind: 'list', scope: 'root' },
      'settings.close': { kind: 'single', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    })
    expect(registrations[9]?.children).toEqual({
      'settings.general.item': { kind: 'list', scope: 'root' },
    })
    expect(localeRegister).toHaveBeenCalledWith(SETTINGS_NAMESPACE, 'zh', SETTINGS_MESSAGES.zh)
    expect(localeRegister).toHaveBeenCalledWith(SETTINGS_NAMESPACE, 'en', SETTINGS_MESSAGES.en)

    for (const dispose of effectDisposers.reverse()) dispose()
    expect(disposeZh).toHaveBeenCalledTimes(1)
    expect(disposeEn).toHaveBeenCalledTimes(1)
  })

  it('is the single default-profile owner of global BeUI CSS', () => {
    expect(clientSource).toContain("import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '@convax/beui/styles'")
    expect(clientSource).toContain("{ 'data-convax-beui': true }")
    expect(clientSource).toContain('`${BEUI_THEME_CSS}\\n${BEUI_COMPONENT_CSS}\\n${CONVAX_SETTINGS_CSS}`')
    expect(clientSource).toContain("color: 'var(--cvx-beui-primary-foreground)'")
    expect(clientSource).not.toContain("color: 'var(--dsw-alias-bg-layer-1)'")
  })

  it('keeps the wide settings trigger from inheriting BeUI icon-button width', () => {
    expect(CONVAX_SETTINGS_CSS).toMatch(/\.cvxSettingsTrigger\.cvxBeuiButton\[data-size="icon"\]\[data-wide="true"\]\s*\{[^}]*width:\s*100%/su)
  })

  it('ships complete Chinese and English settings dictionaries', () => {
    expect(Object.keys(SETTINGS_MESSAGES.zh).sort()).toEqual(Object.keys(SETTINGS_MESSAGES.en).sort())
    expect(SETTINGS_MESSAGES.zh.trigger).toBe('设置')
    expect(SETTINGS_MESSAGES.en.trigger).toBe('Settings')
  })
})
