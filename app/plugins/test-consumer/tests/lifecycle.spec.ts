import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Runtime from '@convax/runtime'
import * as Consumer from '../src/index.ts'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2
const FIBER_FAILED = 3

afterEach(() => { Consumer.resetDiagnostics() })

describe('Cordis service lifecycle', () => {
  it('is order independent and unloads/reloads the consumer with its provider', async () => {
    const ctx = new Context()
    const consumer = ctx.plugin(Consumer)
    expect(consumer.state).toBe(FIBER_PENDING)

    const provider = await ctx.plugin(Runtime, { profile: 'lifecycle' })
    await consumer
    expect(consumer.state).toBe(FIBER_ACTIVE)
    expect(Consumer.snapshotDiagnostics()).toMatchObject({
      activations: 1,
      disposals: 0,
      active: true,
      lastProfile: 'lifecycle',
    })

    ctx.emit('app-runtime/probe')
    expect(Consumer.snapshotDiagnostics().probes).toBe(1)
    await vi.waitFor(() => { expect(Consumer.snapshotDiagnostics().ticks).toBeGreaterThan(0) })

    await provider.dispose()
    await vi.waitFor(() => { expect(consumer.state).toBe(FIBER_PENDING) })
    const stopped = Consumer.snapshotDiagnostics()
    expect(stopped).toMatchObject({ disposals: 1, active: false })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(Consumer.snapshotDiagnostics().ticks).toBe(stopped.ticks)
    ctx.emit('app-runtime/probe')
    expect(Consumer.snapshotDiagnostics().probes).toBe(stopped.probes)

    const restored = await ctx.plugin(Runtime, { profile: 'lifecycle' })
    await consumer
    expect(consumer.state).toBe(FIBER_ACTIVE)
    expect(Consumer.snapshotDiagnostics()).toMatchObject({ activations: 2, active: true })

    await restored.dispose()
    await consumer.dispose()
    await ctx.fiber.dispose()
  })

  it('fails a duplicate appRuntime provider instead of selecting one', async () => {
    const ctx = new Context()
    ctx.logger.error = vi.fn()
    const first = await ctx.plugin(Runtime, { profile: 'first' })
    const duplicate = ctx.plugin(Runtime, { profile: 'second' })
    await expect(duplicate).rejects.toThrow(/service "appRuntime" has been registered/)
    expect(duplicate.state).toBe(FIBER_FAILED)
    expect((ctx.get('appRuntime') as Runtime.AppRuntime).profile).toBe('first')

    await duplicate.dispose()
    await first.dispose()
    await ctx.fiber.dispose()
  })
})
