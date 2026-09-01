import { describe, expect, it } from 'vitest'
import { ConvaxThemePresenter } from '../src/client/theme-presenter.ts'

class FakeStyle {
  readonly values = new Map<string, string>()
  setProperty(name: string, value: string): void { this.values.set(name, value) }
  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? ''
    this.values.delete(name)
    return previous
  }
}

function createDocumentFixture(): {
  readonly document: Document
  readonly rootStyle: FakeStyle
  readonly bodyStyle: FakeStyle
  readonly bodyAttributes: Set<string>
  readonly metas: Array<{ name: string; content: string; isConnected: boolean; remove(): void }>
} {
  const rootStyle = new FakeStyle()
  const bodyStyle = new FakeStyle()
  const bodyAttributes = new Set<string>()
  const metas: Array<{ name: string; content: string; isConnected: boolean; remove(): void }> = []
  const document = {
    documentElement: { style: rootStyle },
    body: {
      style: bodyStyle,
      setAttribute(name: string): void { bodyAttributes.add(name) },
      removeAttribute(name: string): void { bodyAttributes.delete(name) },
    },
    createElement(): unknown {
      const meta = {
        name: '',
        content: '',
        isConnected: false,
        remove(): void { meta.isConnected = false },
      }
      metas.push(meta)
      return meta
    },
    head: {
      append(meta: { isConnected: boolean }): void { meta.isConnected = true },
    },
    defaultView: {
      getComputedStyle: () => ({ backgroundColor: 'rgb(17, 20, 15)' }),
    },
  } as unknown as Document
  return { document, rootStyle, bodyStyle, bodyAttributes, metas }
}

describe('Convax theme presenter', () => {
  it('projects theme snapshots and retracts only presenter-owned DOM state', () => {
    const fixture = createDocumentFixture()
    const presenter = new ConvaxThemePresenter(fixture.document)

    presenter.apply({
      active: {
        id: 'dark',
        colorScheme: 'dark',
        tokens: {
          '--dsw-alias-brand-primary': '#c6f22d',
          '--dsw-alias-bg-base': '#11140f',
        },
      },
    } as never)

    expect(fixture.rootStyle.values.get('color-scheme')).toBe('dark')
    expect(fixture.bodyAttributes.has('data-ds-dark-theme')).toBe(true)
    expect(fixture.bodyStyle.values.get('--dsw-alias-brand-primary')).toBe('#c6f22d')
    expect(fixture.metas[0]).toMatchObject({
      name: 'theme-color',
      content: 'rgb(17, 20, 15)',
      isConnected: true,
    })

    presenter.apply({
      active: {
        id: 'light',
        colorScheme: 'light',
        tokens: { '--dsw-alias-label-primary': '#171a17' },
      },
    } as never)
    expect(fixture.bodyAttributes.has('data-ds-dark-theme')).toBe(false)
    expect(fixture.bodyStyle.values.has('--dsw-alias-brand-primary')).toBe(false)
    expect(fixture.bodyStyle.values.get('--dsw-alias-label-primary')).toBe('#171a17')

    presenter.dispose()
    expect(fixture.rootStyle.values.has('color-scheme')).toBe(false)
    expect(fixture.bodyStyle.values.size).toBe(0)
    expect(fixture.metas[0]?.isConnected).toBe(false)
  })
})
