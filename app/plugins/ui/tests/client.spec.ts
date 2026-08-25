import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('Convax client brand', () => {
  it('occupies only the three documented generic brand slots', () => {
    const registrations: string[] = []
    const slots = {
      inject(_name: string, callback: () => unknown): unknown {
        const result = callback()
        if (result !== null && typeof result === 'object' && Symbol.iterator in result) {
          return [...result as Iterable<unknown>]
        }
        return result
      },
      register(options: { name: string }): () => void {
        registrations.push(options.name)
        return () => undefined
      },
    }

    apply({ slots } as never)
    expect(registrations).toEqual([
      'sidebar.brand.mark',
      'sidebar.brand.name',
      'conversation.hero.brand.mark',
    ])
  })
})
