import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

describe('Convax Comic BeUI client foundation', () => {
  it('registers global styles and the documented brand slots', () => {
    const registrations: Array<{ name: string; id?: string }> = []
    const disposeTheme = vi.fn()
    const overrideTokens = vi.fn((_source: string, _tokens: unknown) => disposeTheme)
    let effectDisposer: (() => void) | undefined
    const slots = {
      inject(_name: string, callback: () => unknown): unknown {
        const result = callback()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
          return [...result as Iterable<unknown>]
        }
        return result
      },
      register(options: { name: string; id?: string }): () => void {
        registrations.push(options)
        return () => undefined
      },
    }

    apply({
      effect(callback: () => () => void): void { effectDisposer = callback() },
      slots,
      theme: { overrideTokens },
    } as never)

    expect(inject).toEqual(['slots', 'theme'])
    expect(registrations).toEqual([
      { name: 'shell.overlay', id: 'app-ui-beui-styles', order: -1_000 },
      { name: 'sidebar.brand.mark' },
      { name: 'sidebar.brand.name' },
      { name: 'conversation.hero.brand.mark' },
    ])
    expect(overrideTokens).toHaveBeenCalledTimes(1)
    expect(overrideTokens.mock.calls[0]?.[0]).toBe('convax-beui')
    expect(overrideTokens.mock.calls[0]?.[1]).toMatchObject({
      '--dsw-alias-bg-base': { light: '#f7f8f6', dark: '#11140f' },
      '--dsw-alias-brand-primary': { light: '#5f7f00', dark: '#c6f22d' },
    })

    effectDisposer?.()
    expect(disposeTheme).toHaveBeenCalledTimes(1)
  })
})
