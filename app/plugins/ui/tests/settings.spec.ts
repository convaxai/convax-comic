import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { SettingsDocumentController } from '../src/client/settings.tsx'

const settingsSource = await readFile(new URL('../src/client/settings.tsx', import.meta.url), 'utf8')

describe('Convax settings presentation', () => {
  it('does not mount the upstream onboarding disclaimer', () => {
    expect(settingsSource).not.toContain("renderSlot('settings.onboarding'")
    expect(settingsSource).not.toContain('onboardingSteps')
  })
})

describe('Convax settings document action', () => {
  it('derives availability from the shared mirror and opens through the pathless API', async () => {
    let snapshot: { view: { hasDocument: boolean } | undefined; error: string | null } = {
      view: undefined,
      error: null,
    }
    let notify: (() => void) | undefined
    const unsubscribe = vi.fn()
    const openDocument = vi.fn(async () => ({ result: { ok: true as const } }))
    const controller = new SettingsDocumentController(
      { settings: { openDocument } },
      {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          notify = listener
          return unsubscribe
        },
        ensure: async () => {
          snapshot = { view: { hasDocument: true }, error: null }
        },
      },
    )
    const listener = vi.fn()
    const off = controller.subscribe(listener)

    await controller.load()
    expect(controller.getSnapshot()).toEqual({ status: 'ready', opening: false, error: null })
    await controller.open()
    expect(openDocument).toHaveBeenCalledWith({})
    expect(controller.getSnapshot()).toEqual({ status: 'ready', opening: false, error: null })

    snapshot = { view: { hasDocument: false }, error: null }
    notify?.()
    expect(controller.getSnapshot().status).toBe('unavailable')
    expect(listener).toHaveBeenCalled()

    off()
    controller.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('keeps localized UI state available after a native-open failure', async () => {
    const controller = new SettingsDocumentController(
      { settings: { openDocument: async () => ({ result: { ok: false as const, error: { message: 'denied' } } }) } },
      {
        getSnapshot: () => ({ view: { hasDocument: true }, error: null }),
        subscribe: () => () => undefined,
        ensure: async () => undefined,
      },
    )

    await controller.load()
    await controller.open()
    expect(controller.getSnapshot()).toEqual({ status: 'ready', opening: false, error: 'denied' })
  })
})
