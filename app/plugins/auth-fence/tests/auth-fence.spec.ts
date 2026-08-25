import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { connect } from 'node:net'
import type { Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AuthenticatedWebServer, {
  CONTROL_TOKEN_ENV,
  CONTROL_TOKEN_HEADER,
  LOOPBACK_HOST,
} from '../src/index.ts'

const VALID_TOKEN = randomBytes(32).toString('hex')
const WRONG_TOKEN = randomBytes(32).toString('hex')
const originalSendDescriptor = Object.getOwnPropertyDescriptor(process, 'send')
const fibers = new Set<Fiber>()
const clients = new Set<Socket>()

interface RunningServer {
  context: Context
  fiber: Fiber
  server: AuthenticatedWebServer
}

beforeEach(() => {
  // Vitest can itself use an IPC child. Tests opt into readiness IPC only in
  // the dedicated assertion so package tests cannot message the test runner.
  Object.defineProperty(process, 'send', {
    configurable: true,
    writable: true,
    value: undefined,
  })
})

afterEach(async () => {
  for (const client of clients) client.destroy()
  clients.clear()
  await Promise.allSettled([...fibers].map(async fiber => fiber.dispose()))
  fibers.clear()

  if (originalSendDescriptor === undefined) {
    Reflect.deleteProperty(process, 'send')
  } else {
    Object.defineProperty(process, 'send', originalSendDescriptor)
  }
})

async function boot(token: string | undefined, port = 0): Promise<RunningServer> {
  const previous = process.env[CONTROL_TOKEN_ENV]
  if (token === undefined) delete process.env[CONTROL_TOKEN_ENV]
  else process.env[CONTROL_TOKEN_ENV] = token

  const context = new Context()
  try {
    const fiber = context.plugin(AuthenticatedWebServer, { host: LOOPBACK_HOST, port })
    fibers.add(fiber)
    await fiber
    return {
      context,
      fiber,
      server: context.webServer as unknown as AuthenticatedWebServer,
    }
  } finally {
    if (previous === undefined) delete process.env[CONTROL_TOKEN_ENV]
    else process.env[CONTROL_TOKEN_ENV] = previous
  }
}

async function request(
  port: number,
  path: string,
  token?: string,
): Promise<{ status: number; body: string }> {
  const init: RequestInit | undefined = token === undefined
    ? undefined
    : { headers: { [CONTROL_TOKEN_HEADER]: token } }
  const response = await fetch(`http://${LOOPBACK_HOST}:${String(port)}${path}`, init)
  return { status: response.status, body: await response.text() }
}

interface UpgradeResult {
  socket: Socket
  firstChunk: string
  closed: Promise<unknown[]>
}

async function upgrade(port: number, path: string, token?: string): Promise<UpgradeResult> {
  const socket = connect(port, LOOPBACK_HOST)
  clients.add(socket)
  socket.once('close', () => { clients.delete(socket) })
  await once(socket, 'connect')

  const firstData = once(socket, 'data')
  const closed = once(socket, 'close')
  const headers = [
    `GET ${path} HTTP/1.1`,
    `Host: ${LOOPBACK_HOST}:${String(port)}`,
    'Connection: Upgrade',
    'Upgrade: convax-test',
  ]
  if (token !== undefined) headers.push(`${CONTROL_TOKEN_HEADER}: ${token}`)
  socket.write([...headers, '', ''].join('\r\n'))

  const [chunk] = await firstData as [Buffer]
  return { socket, firstChunk: String(chunk), closed }
}

describe('@convax/auth-fence', () => {
  it('rejects missing, wrong, and unknown-path HTTP requests before routing', async () => {
    const { server } = await boot(VALID_TOKEN)
    let routeCalls = 0
    let fallbackCalls = 0
    server.register({
      kind: 'exact',
      path: '/route',
      handler: (_request, response) => {
        routeCalls += 1
        response.writeHead(200)
        response.end('route')
      },
    })
    server.registerFallback((_request, response) => {
      fallbackCalls += 1
      response.writeHead(200)
      response.end('fallback')
    })

    await expect(request(server.port, '/route')).resolves.toMatchObject({ status: 403 })
    await expect(request(server.port, '/route', WRONG_TOKEN)).resolves.toMatchObject({ status: 403 })
    await expect(request(server.port, '/static/app.js')).resolves.toMatchObject({ status: 403 })
    expect(routeCalls).toBe(0)
    expect(fallbackCalls).toBe(0)

    await expect(request(server.port, '/route', VALID_TOKEN)).resolves.toEqual({ status: 200, body: 'route' })
    await expect(request(server.port, '/static/app.js', VALID_TOKEN)).resolves.toEqual({
      status: 200,
      body: 'fallback',
    })
    expect(routeCalls).toBe(1)
    expect(fallbackCalls).toBe(1)
  })

  it('preserves exact and longest-prefix routing plus duplicate registration failures', async () => {
    const { server } = await boot(VALID_TOKEN)
    const reply = (body: string) => (_request: unknown, response: { writeHead(status: number): void; end(body: string): void }) => {
      response.writeHead(200)
      response.end(body)
    }

    server.register({ kind: 'prefix', path: '/api', handler: reply('api') })
    server.register({ kind: 'prefix', path: '/api/deep', handler: reply('deep') })
    server.register({ kind: 'exact', path: '/api/deep/item', handler: reply('exact') })
    expect(await request(server.port, '/api/leaf', VALID_TOKEN)).toEqual({ status: 200, body: 'api' })
    expect(await request(server.port, '/api/deep/leaf', VALID_TOKEN)).toEqual({ status: 200, body: 'deep' })
    expect(await request(server.port, '/api/deep/item', VALID_TOKEN)).toEqual({ status: 200, body: 'exact' })

    expect(() => server.register({ kind: 'prefix', path: '/api', handler: reply('duplicate') }))
      .toThrow(/duplicate prefix route/)
    const release = server.register({ kind: 'exact', path: '/once', handler: reply('once') })
    expect(() => server.register({ kind: 'exact', path: '/once', handler: reply('duplicate') }))
      .toThrow(/duplicate exact route/)
    release()
    expect(() => server.register({ kind: 'exact', path: '/once', handler: reply('again') })).not.toThrow()

    const releaseFallback = server.registerFallback(reply('fallback'))
    expect(() => server.registerFallback(reply('duplicate'))).toThrow(/fallback already registered/)
    releaseFallback()
    expect(() => server.registerFallback(reply('again'))).not.toThrow()

    const releaseUpgrade = server.registerUpgrade({ path: '/events', handler: () => {} })
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} }))
      .toThrow(/duplicate upgrade route/)
    releaseUpgrade()
    expect(() => server.registerUpgrade({ path: '/events', handler: () => {} })).not.toThrow()
  })

  it('fences upgrades before dispatch and admits a correctly authenticated upgrade', async () => {
    const { server } = await boot(VALID_TOKEN)
    let handlerCalls = 0
    server.registerUpgrade({
      path: '/events',
      handler: (_request, socket) => {
        handlerCalls += 1
        socket.write([
          'HTTP/1.1 101 Switching Protocols',
          'Connection: Upgrade',
          'Upgrade: convax-test',
          '',
          '',
        ].join('\r\n'))
      },
    })

    const denied = await upgrade(server.port, '/events')
    expect(denied.firstChunk).toContain('HTTP/1.1 403 Forbidden')
    await denied.closed
    expect(handlerCalls).toBe(0)

    const admitted = await upgrade(server.port, '/events?stream=mux', VALID_TOKEN)
    expect(admitted.firstChunk).toContain('HTTP/1.1 101 Switching Protocols')
    expect(handlerCalls).toBe(1)
    admitted.socket.destroy()
    await admitted.closed
  })

  it('binds only loopback on a random port and rejects unsafe host config', async () => {
    const { server } = await boot(VALID_TOKEN)
    expect(server.host).toBe(LOOPBACK_HOST)
    expect(server.port).toBeGreaterThan(0)

    const previous = process.env[CONTROL_TOKEN_ENV]
    process.env[CONTROL_TOKEN_ENV] = VALID_TOKEN
    const context = new Context()
    try {
      const fiber = context.plugin(AuthenticatedWebServer, { host: '0.0.0.0', port: 0 } as never)
      fibers.add(fiber)
      await expect(fiber).rejects.toThrow()
    } finally {
      if (previous === undefined) delete process.env[CONTROL_TOKEN_ENV]
      else process.env[CONTROL_TOKEN_ENV] = previous
    }
  })

  it('requires a token encoding at least 256 bits', async () => {
    await expect(boot(undefined)).rejects.toThrow(new RegExp(`${CONTROL_TOKEN_ENV} is required`))
    await expect(boot('00'.repeat(31))).rejects.toThrow(/at least 32 bytes/)
    await expect(boot('a'.repeat(62))).rejects.toThrow(/at least 32 bytes/)
    await expect(boot('not a token with spaces')).rejects.toThrow(/hex or base64url/)
  })

  it('sends a token-free readiness message after listening', async () => {
    const messages: unknown[] = []
    Object.defineProperty(process, 'send', {
      configurable: true,
      writable: true,
      value: (message: unknown) => {
        messages.push(message)
        return true
      },
    })

    const { server } = await boot(VALID_TOKEN)
    expect(messages).toEqual([{
      type: 'convax:ready',
      origin: `http://${LOOPBACK_HOST}:${String(server.port)}`,
    }])
    expect(JSON.stringify(messages)).not.toContain(VALID_TOKEN)
  })

  it('does not announce readiness until an installed Loader settles', async () => {
    const messages: unknown[] = []
    const gate = Promise.withResolvers<void>()
    Object.defineProperty(process, 'send', {
      configurable: true,
      writable: true,
      value: (message: unknown) => {
        messages.push(message)
        return true
      },
    })
    const previous = process.env[CONTROL_TOKEN_ENV]
    process.env[CONTROL_TOKEN_ENV] = VALID_TOKEN
    const context = new Context()
    context.provide('loader', { await: () => gate.promise })
    try {
      const fiber = context.plugin(AuthenticatedWebServer, { host: LOOPBACK_HOST, port: 0 })
      fibers.add(fiber)
      await fiber
      expect(messages).toEqual([])

      gate.resolve()
      await gate.promise
      await expect.poll(() => messages.length).toBe(1)
      expect(JSON.stringify(messages)).not.toContain(VALID_TOKEN)
    } finally {
      if (previous === undefined) delete process.env[CONTROL_TOKEN_ENV]
      else process.env[CONTROL_TOKEN_ENV] = previous
    }
  })

  it('reports a settled Loader failure without announcing a usable origin', async () => {
    const messages: unknown[] = []
    const gate = Promise.withResolvers<void>()
    Object.defineProperty(process, 'send', {
      configurable: true,
      writable: true,
      value: (message: unknown) => {
        messages.push(message)
        return true
      },
    })
    const previous = process.env[CONTROL_TOKEN_ENV]
    process.env[CONTROL_TOKEN_ENV] = VALID_TOKEN
    const context = new Context()
    context.provide('loader', { await: () => gate.promise })
    try {
      const fiber = context.plugin(AuthenticatedWebServer, { host: LOOPBACK_HOST, port: 0 })
      fibers.add(fiber)
      await fiber

      gate.reject(new Error('broken composition row'))
      await expect.poll(() => messages.length).toBe(1)
      expect(messages).toEqual([{
        type: 'convax:startup-failed',
        message: 'broken composition row',
      }])
      expect(JSON.stringify(messages)).not.toContain(VALID_TOKEN)
    } finally {
      if (previous === undefined) delete process.env[CONTROL_TOKEN_ENV]
      else process.env[CONTROL_TOKEN_ENV] = previous
    }
  })

  it('closes the listener and authenticated upgraded sockets on provider disposal', async () => {
    const { fiber, server } = await boot(VALID_TOKEN)
    server.register({
      kind: 'exact',
      path: '/health',
      handler: (_request, response) => {
        response.writeHead(200)
        response.end('ok')
      },
    })
    server.registerUpgrade({
      path: '/events',
      handler: (_request, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: convax-test\r\n\r\n')
      },
    })

    const upgraded = await upgrade(server.port, '/events', VALID_TOKEN)
    const port = server.port
    expect(await request(port, '/health', VALID_TOKEN)).toEqual({ status: 200, body: 'ok' })

    await fiber.dispose()
    await upgraded.closed
    await expect(fetch(`http://${LOOPBACK_HOST}:${String(port)}/health`, {
      signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow()
  })

  it('keeps index rendering compatible with upstream consumers', async () => {
    const { context, server } = await boot(VALID_TOKEN)
    context.on('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__CONVAX_TEST__', value: { ready: true } })
    })
    const untap = server.tapIndex(html => html.replace('</body>', '<p>tap</p></body>'))

    expect(server.renderIndex('<html><head></head><body></body></html>'))
      .toContain('globalThis["__CONVAX_TEST__"] = {"ready":true}')
    expect(server.renderIndex('<html><head></head><body></body></html>')).toContain('<p>tap</p>')
    untap()
    expect(server.renderIndex('<html><head></head><body></body></html>')).not.toContain('<p>tap</p>')
  })
})
