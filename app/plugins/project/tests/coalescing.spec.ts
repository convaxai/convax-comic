import { afterEach, describe, expect, it, vi } from 'vitest'
import { InvalidationCoalescer } from '../src/host/project-files.ts'

afterEach(() => { vi.useRealTimers() })

describe('project invalidation coalescing', () => {
  it('deduplicates and stably sorts one burst', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const coalescer = new InvalidationCoalescer(flush, 75)
    coalescer.add('src/client')
    coalescer.add('src')
    coalescer.add('src/client')
    vi.advanceTimersByTime(74)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledWith(['src', 'src/client'])
  })

  it('contains scheduled callbacks after close', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const coalescer = new InvalidationCoalescer(flush, 75)
    coalescer.add('src')
    coalescer.close()
    vi.runAllTimers()
    expect(flush).not.toHaveBeenCalled()
  })
})
