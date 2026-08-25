import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { SpawnOptions } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopPaths } from '../src/profile-args.js'
import {
  DshSupervisor,
  type ManagedChild,
  type SpawnManagedChild,
} from '../src/supervisor.js'
import type { LaunchLog } from '../src/redaction.js'

class FakeChild extends EventEmitter implements ManagedChild {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly kills: Array<NodeJS.Signals | number | undefined> = []
  readonly sent: unknown[] = []
  connected = true

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal)
    return true
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message)
    callback?.(null)
    return true
  }
}

class MemoryLog implements LaunchLog {
  readonly chunks: string[] = []
  closed = false

  write(channel: 'stdout' | 'stderr' | 'shell', chunk: string | Uint8Array): void {
    this.chunks.push(`${channel}:${String(chunk)}`)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

interface SpawnCall {
  readonly command: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
  readonly child: FakeChild
}

function harness(tokens: readonly string[]) {
  const calls: SpawnCall[] = []
  const logs: MemoryLog[] = []
  const spawnChild: SpawnManagedChild = (command, args, options) => {
    const child = new FakeChild()
    calls.push({ command, args, options, child })
    return child
  }
  let tokenIndex = 0
  const supervisor = new DshSupervisor({
    nodeBinary: '/runtime/node',
    dshCli: '/runtime/dsh/lib/bin.js',
    parentGuard: '/runtime/desktop/parent-guard.cjs',
    profile: 'default',
    trustedSecurityPatch: '/product/profiles/security.patch.yml',
    paths: desktopPaths('/tmp/convax-supervisor'),
    startupTimeoutMs: 100,
    restartDelayMs: 10,
    stopTimeoutMs: 50,
    spawnChild,
    tokenFactory: () => tokens[tokenIndex++] ?? 'z'.repeat(43),
    logFactory: () => {
      const log = new MemoryLog()
      logs.push(log)
      return log
    },
  })
  return { supervisor, calls, logs }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DSH child supervisor', () => {
  it('uses independent Node, named-profile argv ordering, and isolated data paths', () => {
    const { supervisor, calls } = harness(['a'.repeat(43)])
    supervisor.start()
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.command).toBe('/runtime/node')
    expect(call.args).toEqual([
      '--require',
      '/runtime/desktop/parent-guard.cjs',
      '/runtime/dsh/lib/bin.js',
      '--profile',
      'default',
      '--patch',
      '/product/profiles/security.patch.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ])
    expect(call.options.cwd).toBe('/tmp/convax-supervisor/launch-root')
    expect(call.options.detached).toBe(process.platform !== 'win32')
    expect(call.options.env?.DSH_HOME).toBe('/tmp/convax-supervisor/harness')
    expect(call.options.env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it('fails closed on readiness timeout', async () => {
    vi.useFakeTimers()
    const { supervisor, calls } = harness(['a'.repeat(43)])
    const failures: Error[] = []
    supervisor.on('failed', (error) => failures.push(error))
    supervisor.start()
    await vi.advanceTimersByTimeAsync(101)
    expect(supervisor.status).toBe('failed')
    expect(failures[0]?.message).toContain('readiness timed out')
    expect(calls[0]!.child.kills).toContain('SIGKILL')
  })

  it('fails immediately when the composed Loader reports a startup error', () => {
    const { supervisor, calls } = harness(['a'.repeat(43)])
    const failures: Error[] = []
    supervisor.on('failed', (error) => failures.push(error))
    supervisor.start()

    calls[0]!.child.emit('message', {
      type: 'convax:startup-failed',
      message: 'app-runtime could not load',
    })

    expect(supervisor.status).toBe('failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain('app-runtime could not load')
    expect(calls[0]!.child.kills).toContain('SIGKILL')
    expect(supervisor.getLaunchContext()).toMatchObject({ origin: null, ready: false })
  })

  it('rotates token and origin after an externally killed child', async () => {
    vi.useFakeTimers()
    const tokenA = 'a'.repeat(43)
    const tokenB = 'b'.repeat(43)
    const { supervisor, calls } = harness([tokenA, tokenB])
    supervisor.start()
    calls[0]!.child.emit('message', {
      type: 'convax:ready',
      origin: 'http://127.0.0.1:41001',
    })
    calls[0]!.child.emit('message', { type: 'convax:desktop-query' })
    expect(calls[0]!.child.sent.at(-1)).toEqual({
      type: 'convax:desktop-state',
      origin: 'http://127.0.0.1:41001',
      profile: 'default',
      ready: true,
    })
    expect(supervisor.getLaunchContext()).toMatchObject({
      token: tokenA,
      origin: 'http://127.0.0.1:41001',
      ready: true,
    })
    calls[0]!.child.emit('message', {
      type: 'convax:startup-failed',
      message: 'late stale failure',
    })
    expect(supervisor.status).toBe('ready')
    expect(calls[0]!.child.kills).toEqual([])

    calls[0]!.child.emit('close', null, 'SIGKILL')
    expect(supervisor.getLaunchContext()).toMatchObject({ token: null, origin: null, ready: false })
    await vi.advanceTimersByTimeAsync(10)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.options.env?.CONVAX_CONTROL_TOKEN).toBe(tokenB)
    calls[1]!.child.emit('message', {
      type: 'convax:ready',
      origin: 'http://127.0.0.1:41002',
    })
    expect(supervisor.getLaunchContext()).toMatchObject({
      token: tokenB,
      origin: 'http://127.0.0.1:41002',
      ready: true,
      generation: 2,
    })
  })

  it('stops the child and never restarts during app shutdown', async () => {
    vi.useFakeTimers()
    const { supervisor, calls } = harness(['a'.repeat(43)])
    supervisor.start()
    const stop = supervisor.stop()
    expect(calls[0]!.child.kills).toContain('SIGTERM')
    calls[0]!.child.emit('close', 0, null)
    await stop
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(1)
    expect(supervisor.status).toBe('idle')
    expect(supervisor.getLaunchContext()).toMatchObject({ token: null, origin: null, ready: false })
  })

  it('stops crash-looping after the bounded restart limit', async () => {
    vi.useFakeTimers()
    const { supervisor, calls } = harness([
      'a'.repeat(43),
      'b'.repeat(43),
      'c'.repeat(43),
      'd'.repeat(43),
    ])
    const failures: Error[] = []
    supervisor.on('failed', (error) => failures.push(error))
    supervisor.start()
    for (let generation = 0; generation < 4; generation += 1) {
      calls[generation]!.child.emit('close', 1, null)
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(calls).toHaveLength(4)
    expect(supervisor.status).toBe('failed')
    expect(failures.at(-1)?.message).toContain('bounded crash restart limit')
  })
})
