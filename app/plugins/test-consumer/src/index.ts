import type { Context } from '@deepseek-ai/cordis'
import type {} from '@convax/runtime'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'app-runtime/probe'(): void
  }
}

export interface ConsumerDiagnostics {
  activations: number
  disposals: number
  probes: number
  ticks: number
  active: boolean
  lastProfile?: string
}

const diagnostics: ConsumerDiagnostics = {
  activations: 0,
  disposals: 0,
  probes: 0,
  ticks: 0,
  active: false,
}

export const name = 'app-test-consumer'
export const inject = ['appRuntime']

export function snapshotDiagnostics(): Readonly<ConsumerDiagnostics> {
  return { ...diagnostics }
}

export function resetDiagnostics(): void {
  diagnostics.activations = 0
  diagnostics.disposals = 0
  diagnostics.probes = 0
  diagnostics.ticks = 0
  diagnostics.active = false
  delete diagnostics.lastProfile
}

export function apply(ctx: Context): void {
  const response = ctx.appRuntime.ping('app-test-consumer')
  if (!response.ok || response.caller !== 'app-test-consumer') {
    throw new Error('app-test-consumer: appRuntime ping contract failed')
  }

  diagnostics.activations += 1
  diagnostics.active = true
  diagnostics.lastProfile = response.profile

  const timer = setInterval(() => { diagnostics.ticks += 1 }, 5)
  ctx.effect(() => () => { clearInterval(timer) }, 'app-test-consumer/timer')
  ctx.on('app-runtime/probe', () => { diagnostics.probes += 1 })
  ctx.effect(() => () => {
    diagnostics.disposals += 1
    diagnostics.active = false
  }, 'app-test-consumer/diagnostics')
}
