import { describe, expect, it } from 'vitest'
import {
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
    const original = { Accept: ['application/json'], 'X-Convax-Control-Token': ['stale'] }
    const next = withControlToken(original, 'fresh')
    expect(next).toEqual({
      Accept: ['application/json'],
      'x-convax-control-token': ['fresh'],
    })
    expect(original['X-Convax-Control-Token']).toEqual(['stale'])
  })
})
