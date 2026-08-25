/**
 * The product authentication boundary for the DSH browser control plane.
 *
 * This class deliberately replaces (rather than wraps) the upstream
 * `webServer` provider: upstream exposes route registries but no pre-dispatch
 * middleware seam. Authentication therefore runs before pathname parsing,
 * named-route matching, static fallback handling, and upgrade dispatch.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import {
  renderIndexInjections,
  type IndexInjection,
  type IndexInjectionPlacement,
  type WebRoute,
  type WebUpgradeRoute,
} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'

export { renderIndexInjections }
export type {
  IndexInjection,
  IndexInjectionPlacement,
  WebRoute,
  WebUpgradeRoute,
}

export const CONTROL_TOKEN_ENV = 'CONVAX_CONTROL_TOKEN'
export const CONTROL_TOKEN_HEADER = 'x-convax-control-token'
export const LOOPBACK_HOST = '127.0.0.1' as const
export const MIN_CONTROL_TOKEN_BYTES = 32

const FORBIDDEN_BODY = 'Forbidden\n'
const FORBIDDEN_UPGRADE_RESPONSE = [
  'HTTP/1.1 403 Forbidden',
  'Connection: close',
  'Cache-Control: no-store',
  'Content-Length: 0',
  '',
  '',
].join('\r\n')

export interface Config {
  host: typeof LOOPBACK_HOST
  port: number
}

export interface ReadyMessage {
  type: 'convax:ready'
  origin: `http://${typeof LOOPBACK_HOST}:${number}`
}

export interface StartupFailureMessage {
  type: 'convax:startup-failed'
  message: string
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/** Return the decoded length without retaining decoded token bytes. */
function decodedTokenLength(token: string): number {
  if (/^[0-9a-fA-F]+$/.test(token) && token.length % 2 === 0) {
    // Prefer the less-dense hex interpretation for ambiguous all-hex input;
    // otherwise a 248-bit hex token could be mistaken for longer base64url.
    return token.length / 2
  }

  const unpadded = token.replace(/={1,2}$/, '')
  if (/^[A-Za-z0-9_-]+$/.test(unpadded) && token.slice(unpadded.length).length <= 2) {
    const decoded = Buffer.from(unpadded, 'base64url')
    if (decoded.toString('base64url') === unpadded) {
      const length = decoded.length
      decoded.fill(0)
      return length
    }
    decoded.fill(0)
  }

  return -1
}

function readExpectedTokenDigest(environment: NodeJS.ProcessEnv): Buffer {
  const token = environment[CONTROL_TOKEN_ENV]
  if (token === undefined || token.length === 0) {
    throw new Error(`auth-fence: ${CONTROL_TOKEN_ENV} is required`)
  }

  const byteLength = decodedTokenLength(token)
  if (byteLength < 0) {
    throw new Error(`auth-fence: ${CONTROL_TOKEN_ENV} must be hex or base64url`)
  }
  if (byteLength < MIN_CONTROL_TOKEN_BYTES) {
    throw new Error(
      `auth-fence: ${CONTROL_TOKEN_ENV} must encode at least ${String(MIN_CONTROL_TOKEN_BYTES)} bytes`,
    )
  }

  return createHash('sha256').update(token, 'utf8').digest()
}

function digestPresentedToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest()
}

/**
 * Authenticated, loopback-only implementation of the upstream `webServer`
 * service contract. It is intentionally the sole provider for that name.
 */
export class AuthenticatedWebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.const(LOOPBACK_HOST).required(),
    port: z.natural().max(65535).required(),
  })

  private readonly exact = new Map<string, WebRoute>()
  private readonly prefixes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private readonly upgradedSockets = new Set<Duplex>()
  private readonly indexTaps: ((html: string) => string)[] = []
  private readonly expectedTokenDigest: Buffer
  private readonly requestedPort: number
  private fallback: WebRoute['handler'] | undefined
  private server: Server | undefined
  private listenedPort: number | undefined
  private closing: Promise<void> | undefined
  private active = false

  constructor(ctx: Context, config: Config) {
    if (config.host !== LOOPBACK_HOST) {
      throw new Error(`auth-fence: host must be ${LOOPBACK_HOST}`)
    }
    if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
      throw new Error('auth-fence: port must be an integer between 0 and 65535')
    }
    const expectedTokenDigest = readExpectedTokenDigest(process.env)

    super(ctx, 'webServer')
    this.expectedTokenDigest = expectedTokenDigest
    this.requestedPort = config.port
  }

  /** The OS-assigned port after activation. */
  get port(): number {
    if (this.listenedPort === undefined) {
      throw new Error('auth-fence: webServer has not started listening')
    }
    return this.listenedPort
  }

  /** The only supported bind host. */
  get host(): typeof LOOPBACK_HOST {
    return LOOPBACK_HOST
  }

  register(route: WebRoute): () => void {
    const table = route.kind === 'exact' ? this.exact : this.prefixes
    if (table.has(route.path)) {
      throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
    }
    table.set(route.path, route)
    return () => { table.delete(route.path) }
  }

  registerUpgrade(route: WebUpgradeRoute): () => void {
    if (this.upgrades.has(route.path)) {
      throw new Error(`webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    return () => { this.upgrades.delete(route.path) }
  }

  registerFallback(handler: WebRoute['handler']): () => void {
    if (this.fallback !== undefined) {
      throw new Error('webserver: fallback already registered')
    }
    this.fallback = handler
    return () => { this.fallback = undefined }
  }

  tapIndex(transform: (html: string) => string): () => void {
    this.indexTaps.push(transform)
    return () => {
      const index = this.indexTaps.indexOf(transform)
      if (index !== -1) this.indexTaps.splice(index, 1)
    }
  }

  applyIndexTaps(html: string): string {
    let output = html
    for (const transform of this.indexTaps) output = transform(output)
    return output
  }

  collectIndexInjections(): IndexInjection[] {
    const table: IndexInjection[] = []
    this.ctx.emit('webserver/index-inject', table)
    return table
  }

  renderIndex(html: string): string {
    return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))
  }

  async [Service.init](): Promise<void> {
    this.server = createServer((request, response) => {
      this.handleHttp(request, response).catch((error: unknown) => {
        this.ctx.logger.warn(toError(error))
        if (response.headersSent) {
          response.destroy()
          return
        }
        response.writeHead(400)
        response.end()
      })
    })

    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      const server = this.server
      if (server === undefined) {
        reject(new Error('auth-fence: server was not created'))
        return
      }
      server.once('error', reject)
      server.listen(this.requestedPort, LOOPBACK_HOST, () => {
        server.off('error', reject)
        server.on('error', (error) => { this.ctx.logger.error(error) })
        this.listenedPort = (server.address() as AddressInfo).port
        resolve()
      })
    })

    this.active = true
    this.ctx.effect(() => () => this.close(), 'auth-fence.listen')
    this.announceWhenSettled()
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const presented = request.headers[CONTROL_TOKEN_HEADER]
    if (typeof presented !== 'string') return false
    const presentedDigest = digestPresentedToken(presented)
    return timingSafeEqual(this.expectedTokenDigest, presentedDigest)
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.isAuthorized(request)) {
      response.writeHead(403, {
        'cache-control': 'no-store',
        'content-length': String(Buffer.byteLength(FORBIDDEN_BODY)),
        'content-type': 'text/plain; charset=utf-8',
      })
      response.end(FORBIDDEN_BODY)
      return
    }

    /* node:http always provides url for incoming server requests. */
    const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname
    const route = this.match(pathname)
    if (route !== undefined) {
      await route.handler(request, response)
      return
    }

    const fallback = this.fallback
    if (fallback === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    await fallback(request, response)
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const onError = (error: Error): void => {
      this.ctx.logger.warn(error)
      socket.destroy()
    }
    socket.on('error', onError)
    socket.once('close', () => {
      socket.off('error', onError)
      this.upgradedSockets.delete(socket)
    })
    this.upgradedSockets.add(socket)

    if (!this.isAuthorized(request)) {
      socket.once('finish', () => { socket.destroy() })
      socket.end(FORBIDDEN_UPGRADE_RESPONSE)
      return
    }

    let route: WebUpgradeRoute | undefined
    try {
      route = this.upgrades.get(new URL(request.url ?? '/', 'http://loopback.invalid').pathname)
    } catch (error) {
      this.ctx.logger.warn(toError(error))
      socket.destroy()
      return
    }

    if (route === undefined) {
      socket.destroy()
      return
    }

    try {
      Promise.resolve(route.handler(request, socket, head)).catch((error: unknown) => {
        this.ctx.logger.warn(toError(error))
        socket.destroy()
      })
    } catch (error) {
      this.ctx.logger.warn(toError(error))
      socket.destroy()
    }
  }

  private match(pathname: string): WebRoute | undefined {
    const exact = this.exact.get(pathname)
    if (exact !== undefined) return exact

    let best: WebRoute | undefined
    for (const [prefix, route] of this.prefixes) {
      if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue
      if (best === undefined || prefix.length > best.path.length) best = route
    }
    return best
  }

  private sendReady(): void {
    if (typeof process.send !== 'function') return
    const message: ReadyMessage = {
      type: 'convax:ready',
      origin: `http://${LOOPBACK_HOST}:${String(this.port)}` as ReadyMessage['origin'],
    }
    try {
      process.send(message)
    } catch (error) {
      // The parent may disappear between the capability check and send.
      this.ctx.logger.warn(toError(error))
    }
  }

  private sendStartupFailure(error: unknown): void {
    if (typeof process.send !== 'function') return
    const message: StartupFailureMessage = {
      type: 'convax:startup-failed',
      message: toError(error).message.slice(0, 2_000),
    }
    try {
      process.send(message)
    } catch (sendError) {
      this.ctx.logger.warn(toError(sendError))
    }
  }

  /**
   * Listening is necessary but not sufficient readiness: sibling rows still
   * need to mount the static fallback, API routes, and desktop Host service.
   * Waiting asynchronously (without awaiting from Service.init) avoids a
   * Loader deadlock while suppressing readiness for a failed composition.
   */
  private announceWhenSettled(): void {
    const loader = this.ctx.get('loader') as { await(): Promise<unknown> } | undefined
    const settled = loader?.await()
    if (settled === undefined) {
      this.sendReady()
      return
    }
    void settled.then(() => {
      if (this.active) this.sendReady()
    }, (error: unknown) => {
      if (this.active) this.sendStartupFailure(error)
    })
  }

  private close(): Promise<void> {
    this.closing ??= this.closeOnce()
    return this.closing
  }

  private async closeOnce(): Promise<void> {
    this.active = false
    const server = this.server
    if (server === undefined) return

    const serverClosed = server.listening
      ? new Promise<void>((resolve) => { server.close(() => { resolve() }) })
      : Promise.resolve()
    server.closeAllConnections()

    const upgradedClosed = [...this.upgradedSockets].map(socket => {
      if (socket.destroyed) return Promise.resolve()
      return new Promise<void>((resolve) => {
        socket.once('close', () => { resolve() })
        socket.destroy()
      })
    })
    await Promise.all([serverClosed, ...upgradedClosed])
    this.expectedTokenDigest.fill(0)
  }
}

export default AuthenticatedWebServer
