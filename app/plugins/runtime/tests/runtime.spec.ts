import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as Runtime from '../src/index.ts'

describe('appRuntime', () => {
  it('publishes one immutable, profile-scoped service', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(Runtime, { profile: 'test' })
    const runtime = ctx.get('appRuntime') as Runtime.AppRuntime

    expect(runtime).toMatchObject({
      applicationName: 'Convax Comic',
      applicationVersion: '0.1.0',
      mode: 'test',
    })
    expect(runtime.profile).toBe('test')
    expect(runtime.ping('unit')).toEqual({ ok: true, caller: 'unit', profile: 'test' })
    expect(Object.isFrozen(runtime)).toBe(true)

    await fiber.dispose()
    expect(ctx.get('appRuntime')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
