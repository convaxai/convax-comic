import { isDesktopProfile } from './profile-args.js'
import { normalizeLoopbackOrigin } from './security.js'
import { PROFILE_ENV, type DesktopProfile, type DesktopStateMessage } from './types.js'

export const name = '@convax/desktop'
export const inject: readonly string[] = []

export interface AppDesktopService {
  readonly origin: string | null
  readonly profile: DesktopProfile
  readonly ready: boolean
}

interface CordisContext {
  provide(name: 'appDesktop', value: AppDesktopService): void
  effect(callback: () => void | (() => void)): void
}

export function apply(ctx: CordisContext): void {
  const rawProfile = process.env[PROFILE_ENV] ?? 'default'
  const profile: DesktopProfile = isDesktopProfile(rawProfile) ? rawProfile : 'default'
  let origin: string | null = null
  let ready = false

  const service: AppDesktopService = Object.freeze({
    get origin() {
      return origin
    },
    get profile() {
      return profile
    },
    get ready() {
      return ready
    },
  })

  ctx.provide('appDesktop', service)
  ctx.effect(() => {
    const onMessage = (message: unknown) => {
      if (!isDesktopStateMessage(message) || message.profile !== profile) return
      const nextOrigin = message.origin === null ? null : normalizeLoopbackOrigin(message.origin)
      if (message.ready && nextOrigin === null) return
      origin = nextOrigin
      ready = message.ready
    }
    process.on('message', onMessage)
    const onDisconnect = () => {
      // The Electron parent owns this runtime. Losing its IPC channel must
      // enter DSH's existing SIGTERM disposal path so PTYs and agents cannot
      // survive an abruptly terminated shell.
      process.kill(process.pid, 'SIGTERM')
    }
    process.once('disconnect', onDisconnect)
    if (typeof process.send === 'function') {
      process.send({ type: 'convax:desktop-query' }, () => undefined)
    }
    return () => {
      process.off('message', onMessage)
      process.off('disconnect', onDisconnect)
    }
  })
}

function isDesktopStateMessage(message: unknown): message is DesktopStateMessage {
  if (message === null || typeof message !== 'object') return false
  const candidate = message as Partial<DesktopStateMessage>
  return candidate.type === 'convax:desktop-state'
    && (candidate.origin === null || typeof candidate.origin === 'string')
    && candidate.ready !== undefined
    && typeof candidate.ready === 'boolean'
    && candidate.profile !== undefined
    && isDesktopProfile(candidate.profile)
}
