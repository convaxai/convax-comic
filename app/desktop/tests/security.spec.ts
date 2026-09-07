import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  authenticateBrowserSession,
  browserAuthRedirectAccepted,
  navigationDecision,
  normalizeLoopbackOrigin,
  isTrustedDesktopDocument,
  rendererLaunchContext,
  requestMatchesLaunchOrigin,
  withControlToken,
} from '../src/security.js'

describe('exact launch origin', () => {
  it('accepts only a bare random-port IPv4 loopback HTTP origin', () => {
    expect(normalizeLoopbackOrigin('http://127.0.0.1:43123')).toBe('http://127.0.0.1:43123')
    expect(normalizeLoopbackOrigin('http://127.0.0.1:43123/path')).toBeNull()
    expect(normalizeLoopbackOrigin('http://localhost:43123')).toBeNull()
    expect(normalizeLoopbackOrigin('https://127.0.0.1:43123')).toBeNull()
    expect(normalizeLoopbackOrigin('http://127.0.0.1')).toBeNull()
  })

  it('accepts only the one expected browser-auth redirect to the clean runtime root', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(browserAuthRedirectAccepted(303, 'GET', `${origin}/`, origin)).toBe(true)
    expect(browserAuthRedirectAccepted(302, 'GET', `${origin}/`, origin)).toBe(false)
    expect(browserAuthRedirectAccepted(303, 'GET', `${origin}/?token=secret`, origin)).toBe(false)
    expect(browserAuthRedirectAccepted(303, 'GET', 'http://127.0.0.1:43124/', origin)).toBe(false)
  })

  it('synchronously follows the validated browser-auth redirect with session cookies', async () => {
    const origin = 'http://127.0.0.1:43123'
    const request = new EventEmitter() as EventEmitter & {
      abort: ReturnType<typeof vi.fn>
      followRedirect: ReturnType<typeof vi.fn>
      end: ReturnType<typeof vi.fn>
    }
    request.abort = vi.fn()
    request.followRedirect = vi.fn()
    request.end = vi.fn(() => {
      request.emit('redirect', 303, 'GET', `${origin}/`, {})
      queueMicrotask(() => {
        request.emit('response', { statusCode: 200, on: vi.fn() })
      })
      return request
    })
    const createRequest = vi.fn(() => request as never)
    await authenticateBrowserSession(
      createRequest,
      {} as never,
      `${origin}/?token=one-time`,
      origin,
      'control-token',
    )
    expect(createRequest).toHaveBeenCalledWith({
      url: `${origin}/?token=one-time`,
      session: {},
      credentials: 'include',
      headers: { 'x-convax-control-token': 'control-token' },
      redirect: 'manual',
    })
    expect(request.followRedirect).toHaveBeenCalledOnce()
    expect(request.abort).not.toHaveBeenCalled()
  })

  it('aborts an off-origin authentication redirect before forwarding credentials', async () => {
    const request = Object.assign(new EventEmitter(), {
      abort: vi.fn(), followRedirect: vi.fn(), end: vi.fn(),
    })
    request.end.mockImplementation(() => { request.emit('redirect', 303, 'GET', 'https://example.com/', {}) })
    await expect(authenticateBrowserSession(
      () => request as never, {} as never,
      'http://127.0.0.1:43123/?token=one-time', 'http://127.0.0.1:43123', 'control-token',
    )).rejects.toThrow('invalid redirect')
    expect(request.abort).toHaveBeenCalledOnce()
    expect(request.followRedirect).not.toHaveBeenCalled()
  })

  it('allows current-origin navigation, externalizes remote web URLs, and denies stale loopback', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(navigationDecision(`${origin}/conversation`, origin)).toBe('allow')
    expect(navigationDecision('https://example.com/docs', origin)).toBe('external')
    expect(navigationDecision('http://127.0.0.1:43124', origin)).toBe('deny')
    expect(navigationDecision('file:///tmp/secret', origin)).toBe('deny')
  })

  it('matches HTTP and WebSocket only on the current exact authority', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(requestMatchesLaunchOrigin(`${origin}/api`, origin)).toBe(true)
    expect(requestMatchesLaunchOrigin('ws://127.0.0.1:43123/api/events.mux', origin)).toBe(true)
    expect(requestMatchesLaunchOrigin('http://127.0.0.1:43124/api', origin)).toBe(false)
    expect(requestMatchesLaunchOrigin('wss://127.0.0.1:43123/api', origin)).toBe(false)
    expect(requestMatchesLaunchOrigin('https://example.com/', origin)).toBe(false)
  })

  it('trusts only the failure document or current runtime and withholds pre-ready tokens', () => {
    const origin = 'http://127.0.0.1:43123'
    expect(isTrustedDesktopDocument(`${origin}/conversation`, origin)).toBe(true)
    expect(isTrustedDesktopDocument('data:text/html;charset=utf-8,%3Ch1%3Ewait%3C%2Fh1%3E', null)).toBe(true)
    expect(isTrustedDesktopDocument('https://example.com/', origin)).toBe(false)
    const context = { origin, token: 'secret', profile: 'default', ready: true, generation: 2 } as const
    expect(rendererLaunchContext(context, `${origin}/`).token).toBe('secret')
    expect(rendererLaunchContext(context, 'https://example.com/').token).toBeNull()
    expect(rendererLaunchContext({ ...context, ready: false }, `${origin}/`).token).toBeNull()
  })

  it('replaces case-insensitive caller headers without mutating them', () => {
    const original = { Accept: 'application/json', 'X-Convax-Control-Token': 'stale' }
    const next = withControlToken(original, 'fresh')
    expect(next).toEqual({
      Accept: 'application/json',
      'x-convax-control-token': 'fresh',
    })
    expect(original['X-Convax-Control-Token']).toBe('stale')
  })
})
