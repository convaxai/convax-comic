import type { Context } from '@deepseek-ai/cordis'

export interface AppRuntimePing {
  ok: true
  caller: string
  profile: string
}

/** Minimal product runtime seam. It intentionally exposes no file or shell API. */
export interface AppRuntime {
  readonly applicationName: 'Convax'
  readonly applicationVersion: '0.1.0'
  readonly mode: string
  readonly profile: string
  readonly startedAt: number
  ping(caller: string): AppRuntimePing
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    appRuntime: AppRuntime
  }
}

export interface Config {
  profile?: string
}

export const name = 'app-runtime'

export function apply(ctx: Context, config: Config = {}): void {
  const profile = config.profile ?? 'default'
  const service: AppRuntime = Object.freeze({
    applicationName: 'Convax',
    applicationVersion: '0.1.0',
    mode: profile,
    profile,
    startedAt: Date.now(),
    ping(caller: string): AppRuntimePing {
      return { ok: true, caller, profile }
    },
  })
  ctx.provide('appRuntime', service)
}
