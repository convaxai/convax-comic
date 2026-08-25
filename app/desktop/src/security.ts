import type { Session } from 'electron'
import { CONTROL_TOKEN_HEADER, type LaunchContext } from './types.js'

export type NavigationDecision = 'allow' | 'external' | 'deny'
export const FAILURE_DOCUMENT_PREFIX = 'data:text/html;charset=utf-8,'

export function normalizeLoopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:') return null
    if (url.hostname !== '127.0.0.1') return null
    if (url.username !== '' || url.password !== '') return null
    if (url.port === '') return null
    const port = Number(url.port)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null
    if (url.origin !== value) return null
    return url.origin
  } catch {
    return null
  }
}

export function navigationDecision(
  target: string,
  currentOrigin: string | null,
): NavigationDecision {
  try {
    const url = new URL(target)
    if (currentOrigin !== null && url.origin === currentOrigin) return 'allow'
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') {
      return 'deny'
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') return 'external'
    return 'deny'
  } catch {
    return 'deny'
  }
}

export function isTrustedDesktopDocument(
  target: string,
  currentOrigin: string | null,
): boolean {
  if (target.startsWith(FAILURE_DOCUMENT_PREFIX)) return true
  if (currentOrigin === null) return false
  try {
    return new URL(target).origin === currentOrigin
  } catch {
    return false
  }
}

export function rendererLaunchContext(
  context: Readonly<LaunchContext>,
  documentUrl: string,
): Readonly<LaunchContext> {
  const revealToken = context.ready
    && context.origin !== null
    && isTrustedDesktopDocument(documentUrl, context.origin)
    && !documentUrl.startsWith(FAILURE_DOCUMENT_PREFIX)
  return Object.freeze({
    ...context,
    token: revealToken ? context.token : null,
  })
}

export function requestMatchesLaunchOrigin(
  target: string,
  currentOrigin: string | null,
): boolean {
  if (currentOrigin === null || normalizeLoopbackOrigin(currentOrigin) === null) return false
  try {
    const requestUrl = new URL(target)
    const launchUrl = new URL(currentOrigin)
    if (requestUrl.username !== '' || requestUrl.password !== '') return false
    const allowedProtocol = requestUrl.protocol === 'http:' || requestUrl.protocol === 'ws:'
    return allowedProtocol
      && requestUrl.hostname === launchUrl.hostname
      && requestUrl.port === launchUrl.port
  } catch {
    return false
  }
}

export type HeaderValue = string | string[]
export type RequestHeaders = Record<string, HeaderValue>

export function withControlToken(
  headers: Readonly<RequestHeaders>,
  token: string,
): RequestHeaders {
  const next: RequestHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== CONTROL_TOKEN_HEADER) next[name] = value
  }
  next[CONTROL_TOKEN_HEADER] = [token]
  return next
}

export function installControlTokenInjector(
  targetSession: Session,
  getContext: () => Readonly<LaunchContext>,
  getTrustedWebContentsId: () => number | null,
): () => void {
  targetSession.webRequest.onBeforeSendHeaders(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const context = getContext()
      if (
        context.ready
        && context.token !== null
        && details.webContentsId === getTrustedWebContentsId()
        && requestMatchesLaunchOrigin(details.url, context.origin)
      ) {
        callback({
          requestHeaders: withControlToken(details.requestHeaders, context.token) as typeof details.requestHeaders,
        })
        return
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  return () => {
    targetSession.webRequest.onBeforeSendHeaders(null)
  }
}
