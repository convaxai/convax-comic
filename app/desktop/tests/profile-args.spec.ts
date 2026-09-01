import { dirname, isAbsolute, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildDshArgs,
  childEnvironment,
  desktopPaths,
  parseDesktopLaunchOptions,
} from '../src/profile-args.js'

describe('named DSH profile arguments', () => {
  it('places all launcher flags before the inner web boundary', () => {
    const args = buildDshArgs({
      profile: 'compatibility',
      trustedSecurityPatch: '/Applications/Convax Comic.app/Contents/Resources/profiles/security.patch.yml',
    })
    expect(args).toEqual([
      '--profile',
      'compatibility',
      '--patch',
      '/Applications/Convax Comic.app/Contents/Resources/profiles/security.patch.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ])
    expect(args).not.toContain('web')
    const innerBoundary = args.indexOf('--host')
    expect(args.slice(innerBoundary)).not.toContain('--profile')
    expect(args.filter(argument => argument === '--patch')).toHaveLength(1)
  })

  it('requires an absolute product-owned security overlay', () => {
    expect(() => buildDshArgs({
      profile: 'default',
      trustedSecurityPatch: 'security.patch.yml',
    })).toThrow(/absolute path/)
  })

  it('parses only named product profiles', () => {
    const options = parseDesktopLaunchOptions(['electron', '--profile', 'default'])
    expect(options).toEqual({ profile: 'default' })
    expect(() => parseDesktopLaunchOptions(['--profile', 'web'])).toThrow()
  })

  it('rejects external patches instead of allowing an auth-fence override', () => {
    expect(() => parseDesktopLaunchOptions(['--patch', '/tmp/unsafe.patch.yml']))
      .toThrow(/does not allow external patches/)
    expect(() => parseDesktopLaunchOptions(['--patch=/tmp/unsafe.patch.yml']))
      .toThrow(/does not allow external patches/)
  })
})

describe('desktop data boundaries', () => {
  it('keeps launch data and logs beside, never under, harness', () => {
    const paths = desktopPaths('/tmp/convax-user-data')
    expect(paths.harnessHome).toBe('/tmp/convax-user-data/harness')
    expect(paths.projectsHome).toBe('/tmp/convax-user-data/projects')
    expect(paths.launchRoot).toBe('/tmp/convax-user-data/launch-root')
    expect(paths.logs).toBe('/tmp/convax-user-data/logs')
    expect(dirname(paths.launchRoot)).toBe(paths.userData)
    expect(dirname(paths.logs)).toBe(paths.userData)
    expect(dirname(paths.harnessHome)).toBe(paths.userData)
    expect(dirname(paths.projectsHome)).toBe(paths.userData)
    expect(isAbsolute(paths.harnessHome)).toBe(true)
  })

  it('sets DSH_HOME and strips ELECTRON_RUN_AS_NODE from the child', () => {
    const paths = desktopPaths('/tmp/convax-user-data')
    const env = childEnvironment(
      { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' },
      't'.repeat(43),
      paths,
    )
    expect(env).toEqual({
      PATH: '/bin',
      CONVAX_CONTROL_TOKEN: 't'.repeat(43),
      DSH_HOME: join(paths.userData, 'harness'),
      CONVAX_PROJECTS_HOME: join(paths.userData, 'projects'),
    })
  })
})
