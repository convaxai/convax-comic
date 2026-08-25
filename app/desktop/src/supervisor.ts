import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { buildDshArgs, childEnvironment, type DesktopPaths } from './profile-args.js'
import { RedactingFileLog, redactSecrets, type LaunchLog } from './redaction.js'
import { normalizeLoopbackOrigin } from './security.js'
import type {
  DesktopProfile,
  DesktopStateQuery,
  LaunchContext,
  ReadyMessage,
  StartupFailureMessage,
} from './types.js'

export type SupervisorStatus = 'idle' | 'starting' | 'ready' | 'failed' | 'stopping'

export interface ManagedChild extends EventEmitter {
  readonly pid?: number
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  readonly connected?: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  send?(message: unknown, callback?: (error: Error | null) => void): boolean
}

export type SpawnManagedChild = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ManagedChild

export type SignalManagedTree = (
  child: ManagedChild,
  signal: NodeJS.Signals,
) => boolean

export interface DshSupervisorOptions {
  readonly nodeBinary: string
  readonly dshCli: string
  readonly parentGuard: string
  readonly profile: DesktopProfile
  readonly trustedSecurityPatch: string
  readonly paths: DesktopPaths
  readonly startupTimeoutMs?: number
  readonly restartDelayMs?: number
  readonly restartWindowMs?: number
  readonly maxRestarts?: number
  readonly stopTimeoutMs?: number
  readonly spawnChild?: SpawnManagedChild
  readonly signalTree?: SignalManagedTree
  readonly tokenFactory?: () => string
  readonly logFactory?: (generation: number, token: string) => LaunchLog
  readonly now?: () => number
}

export declare interface DshSupervisor {
  on(event: 'context', listener: (context: Readonly<LaunchContext>) => void): this
  on(event: 'ready', listener: (context: Readonly<LaunchContext>) => void): this
  on(event: 'failed', listener: (error: Error) => void): this
}

export class DshSupervisor extends EventEmitter {
  readonly #options: Required<Pick<
    DshSupervisorOptions,
    'startupTimeoutMs' | 'restartDelayMs' | 'restartWindowMs' | 'maxRestarts' | 'stopTimeoutMs'
  >> & DshSupervisorOptions

  #child: ManagedChild | null = null
  #log: LaunchLog | null = null
  #startupTimer: NodeJS.Timeout | null = null
  #restartTimer: NodeJS.Timeout | null = null
  #desiredStopped = true
  #suppressRestart = false
  #status: SupervisorStatus = 'idle'
  #generation = 0
  #token: string | null = null
  #previousToken: string | null = null
  #origin: string | null = null
  #ready = false
  #crashes: number[] = []

  constructor(options: DshSupervisorOptions) {
    super()
    this.#options = {
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      restartDelayMs: options.restartDelayMs ?? 250,
      restartWindowMs: options.restartWindowMs ?? 60_000,
      maxRestarts: options.maxRestarts ?? 3,
      stopTimeoutMs: options.stopTimeoutMs ?? 7_000,
    }
  }

  get status(): SupervisorStatus {
    return this.#status
  }

  getLaunchContext(): Readonly<LaunchContext> {
    return Object.freeze({
      origin: this.#origin,
      token: this.#token,
      profile: this.#options.profile,
      ready: this.#ready,
      generation: this.#generation,
    })
  }

  start(): void {
    if (!this.#desiredStopped || this.#child !== null || this.#restartTimer !== null) return
    this.#desiredStopped = false
    this.#suppressRestart = false
    this.#crashes = []
    this.#launch()
  }

  async retry(): Promise<void> {
    await this.stop()
    this.start()
  }

  async stop(): Promise<void> {
    this.#desiredStopped = true
    this.#suppressRestart = true
    this.#clearStartupTimer()
    if (this.#restartTimer !== null) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }

    const child = this.#child
    this.#status = child === null ? 'idle' : 'stopping'
    this.#invalidateContext()
    if (child === null) {
      await this.#closeLog()
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      let finalTimer: NodeJS.Timeout | null = null
      const settle = () => {
        if (settled) return
        settled = true
        clearTimeout(forceTimer)
        if (finalTimer !== null) clearTimeout(finalTimer)
        child.off('close', settle)
        resolve()
      }
      const forceTimer = setTimeout(() => {
        this.#signalTree(child, 'SIGKILL')
        finalTimer = setTimeout(settle, 250)
      }, this.#options.stopTimeoutMs)
      child.once('close', settle)
      this.#signalTree(child, 'SIGTERM')
    })

    if (this.#child === child) this.#child = null
    this.#status = 'idle'
    await this.#closeLog()
  }

  #launch(): void {
    if (this.#desiredStopped) return
    this.#suppressRestart = false
    this.#generation += 1
    this.#origin = null
    this.#ready = false
    this.#status = 'starting'
    const token = this.#freshToken()
    this.#token = token
    this.#emitContext()

    const args = buildDshArgs({
      profile: this.#options.profile,
      trustedSecurityPatch: this.#options.trustedSecurityPatch,
    })
    const spawnChild = this.#options.spawnChild ?? ((command, childArgs, spawnOptions) => (
      nodeSpawn(command, childArgs, spawnOptions) as ManagedChild
    ))
    this.#log = this.#options.logFactory?.(this.#generation, token)
      ?? new RedactingFileLog(join(this.#options.paths.logs, 'dsh-runtime.log'), [token])

    let child: ManagedChild
    try {
      child = spawnChild(
        this.#options.nodeBinary,
        ['--require', this.#options.parentGuard, this.#options.dshCli, ...args],
        {
          cwd: this.#options.paths.launchRoot,
          env: childEnvironment(process.env, token, this.#options.paths, this.#options.profile),
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          detached: process.platform !== 'win32',
          windowsHide: true,
        },
      )
    } catch (cause) {
      this.#fail(cause instanceof Error ? cause : new Error(String(cause)))
      return
    }
    this.#child = child

    child.stdout?.on('data', (chunk: Uint8Array | string) => this.#log?.write('stdout', chunk))
    child.stderr?.on('data', (chunk: Uint8Array | string) => this.#log?.write('stderr', chunk))
    child.on('message', (message: unknown) => this.#handleMessage(child, message))
    child.once('error', (error: Error) => {
      this.#log?.write('shell', `${redactSecrets(error.message, [token])}\n`)
    })
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      this.#handleClose(child, code, signal)
    })

    this.#startupTimer = setTimeout(() => {
      if (this.#child !== child || this.#ready) return
      this.#suppressRestart = true
      this.#status = 'failed'
      const error = new Error(`DSH readiness timed out after ${this.#options.startupTimeoutMs}ms`)
      this.emit('failed', error)
      this.#signalTree(child, 'SIGKILL')
    }, this.#options.startupTimeoutMs)
  }

  #handleMessage(child: ManagedChild, message: unknown): void {
    if (this.#child !== child) return
    if (isDesktopStateQuery(message)) {
      this.#sendDesktopState(child)
      return
    }
    if (!this.#ready && isStartupFailureMessage(message)) {
      this.#clearStartupTimer()
      this.#suppressRestart = true
      this.#status = 'failed'
      this.emit('failed', new Error(`DSH composition failed: ${message.message}`))
      this.#signalTree(child, 'SIGKILL')
      return
    }
    if (this.#ready || !isReadyMessage(message)) return
    const origin = normalizeLoopbackOrigin(message.origin)
    if (origin === null) {
      this.#suppressRestart = true
      this.#status = 'failed'
      this.emit('failed', new Error('auth-fence reported an invalid loopback origin'))
      this.#signalTree(child, 'SIGKILL')
      return
    }

    this.#clearStartupTimer()
    this.#origin = origin
    this.#ready = true
    this.#status = 'ready'
    const context = this.getLaunchContext()
    this.#sendDesktopState(child)
    this.emit('context', context)
    this.emit('ready', context)
  }

  #sendDesktopState(child: ManagedChild): void {
    if (child.connected === false || child.send === undefined) return
    child.send({
      type: 'convax:desktop-state',
      origin: this.#origin,
      profile: this.#options.profile,
      ready: this.#ready,
    }, () => undefined)
  }

  #handleClose(
    child: ManagedChild,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.#child !== child) return
    this.#clearStartupTimer()
    this.#signalTree(child, 'SIGKILL')
    this.#child = null
    this.#log?.write('shell', `child closed code=${String(code)} signal=${String(signal)}\n`)
    void this.#closeLog()
    this.#invalidateContext()

    if (this.#desiredStopped) {
      this.#status = 'idle'
      return
    }
    if (this.#suppressRestart) return

    const now = (this.#options.now ?? Date.now)()
    this.#crashes.push(now)
    this.#crashes = this.#crashes.filter((time) => now - time <= this.#options.restartWindowMs)
    if (this.#crashes.length > this.#options.maxRestarts) {
      this.#status = 'failed'
      this.emit('failed', new Error('DSH exceeded the bounded crash restart limit'))
      return
    }

    this.#status = 'starting'
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      this.#launch()
    }, this.#options.restartDelayMs)
  }

  #fail(error: Error): void {
    this.#suppressRestart = true
    this.#status = 'failed'
    this.#invalidateContext()
    this.emit('failed', error)
    void this.#closeLog()
  }

  #signalTree(child: ManagedChild, signal: NodeJS.Signals): boolean {
    const custom = this.#options.signalTree
    if (custom !== undefined) return custom(child, signal)
    if (process.platform !== 'win32' && child.pid !== undefined && child.pid > 0) {
      try {
        process.kill(-child.pid, signal)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      }
    }
    return child.kill(signal)
  }

  #freshToken(): string {
    const factory = this.#options.tokenFactory ?? (() => randomBytes(32).toString('base64url'))
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = factory()
      if (token.length < 32) throw new Error('control token must contain at least 32 characters')
      if (token !== this.#previousToken) {
        this.#previousToken = token
        return token
      }
    }
    throw new Error('control token factory repeated the previous launch token')
  }

  #invalidateContext(): void {
    this.#origin = null
    this.#token = null
    this.#ready = false
    this.#emitContext()
  }

  #emitContext(): void {
    this.emit('context', this.getLaunchContext())
  }

  #clearStartupTimer(): void {
    if (this.#startupTimer !== null) clearTimeout(this.#startupTimer)
    this.#startupTimer = null
  }

  async #closeLog(): Promise<void> {
    const log = this.#log
    this.#log = null
    if (log !== null) await log.close()
  }
}

function isReadyMessage(message: unknown): message is ReadyMessage {
  if (message === null || typeof message !== 'object') return false
  const candidate = message as Partial<ReadyMessage>
  return candidate.type === 'convax:ready' && typeof candidate.origin === 'string'
}

function isStartupFailureMessage(message: unknown): message is StartupFailureMessage {
  if (message === null || typeof message !== 'object') return false
  const candidate = message as Partial<StartupFailureMessage>
  return candidate.type === 'convax:startup-failed'
    && typeof candidate.message === 'string'
    && candidate.message.length > 0
    && candidate.message.length <= 2_000
}

function isDesktopStateQuery(message: unknown): message is DesktopStateQuery {
  if (message === null || typeof message !== 'object') return false
  return (message as Partial<DesktopStateQuery>).type === 'convax:desktop-query'
}
