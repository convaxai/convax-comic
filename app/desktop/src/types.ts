export const CONTROL_TOKEN_ENV = 'CONVAX_CONTROL_TOKEN'
export const CONTROL_TOKEN_HEADER = 'x-convax-control-token'
export const PROFILE_ENV = 'CONVAX_PROFILE'

export const DESKTOP_IPC = Object.freeze({
  getLaunchContext: 'convax:get-launch-context',
  retry: 'convax:retry',
  openLogs: 'convax:open-logs',
  quit: 'convax:quit',
  originChanged: 'convax:origin-changed',
})

export type DesktopProfile = 'default' | 'compatibility'

export interface LaunchContext {
  readonly origin: string | null
  readonly token: string | null
  readonly profile: DesktopProfile
  readonly ready: boolean
  readonly generation: number
}

export interface NativeAffordance {
  // Reserved typed seam. M1 intentionally exposes no native operation.
}

export interface DesktopPreloadApi {
  readonly native: NativeAffordance
  getLaunchContext(): Readonly<LaunchContext>
  retry(): Promise<void>
  openLogs(): Promise<void>
  quit(): Promise<void>
  onOriginChanged(listener: (context: Readonly<LaunchContext>) => void): () => void
}

export interface ReadyMessage {
  readonly type: 'convax:ready'
  readonly origin: string
}

export interface StartupFailureMessage {
  readonly type: 'convax:startup-failed'
  readonly message: string
}

export interface DesktopStateMessage {
  readonly type: 'convax:desktop-state'
  readonly origin: string | null
  readonly profile: DesktopProfile
  readonly ready: boolean
}

export interface DesktopStateQuery {
  readonly type: 'convax:desktop-query'
}

declare global {
  interface Window {
    readonly convaxDesktop: DesktopPreloadApi
  }
}
