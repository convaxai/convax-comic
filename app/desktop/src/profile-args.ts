import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { DesktopProfile } from './types.js'
import { CONTROL_TOKEN_ENV, PROFILE_ENV } from './types.js'

export interface DesktopPaths {
  readonly userData: string
  readonly harnessHome: string
  readonly projectsHome: string
  readonly launchRoot: string
  readonly logs: string
}

export interface DshArgOptions {
  readonly profile: DesktopProfile
  /** Product-owned final overlay; never sourced from desktop argv or userData. */
  readonly trustedSecurityPatch: string
}

export interface DesktopLaunchOptions {
  readonly profile: DesktopProfile
}

export function isDesktopProfile(value: string): value is DesktopProfile {
  return value === 'default' || value === 'compatibility'
}

export function desktopPaths(userData: string): DesktopPaths {
  const absoluteUserData = resolve(userData)
  return Object.freeze({
    userData: absoluteUserData,
    harnessHome: join(absoluteUserData, 'harness'),
    projectsHome: join(absoluteUserData, 'projects'),
    launchRoot: join(absoluteUserData, 'launch-root'),
    logs: join(absoluteUserData, 'logs'),
  })
}

export async function ensureDesktopPaths(paths: DesktopPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.harnessHome, { recursive: true, mode: 0o700 }),
    mkdir(paths.projectsHome, { recursive: true, mode: 0o700 }),
    mkdir(paths.launchRoot, { recursive: true, mode: 0o700 }),
    mkdir(paths.logs, { recursive: true, mode: 0o700 }),
  ])
}

/**
 * DSH launcher arguments must precede inner profile arguments. Named profiles
 * replace the `web` alias, so `--host` is the immutable boundary.
 */
export function buildDshArgs(options: DshArgOptions): readonly string[] {
  if (!isDesktopProfile(options.profile)) {
    throw new TypeError(`unsupported desktop profile: ${String(options.profile)}`)
  }
  if (!isAbsolute(options.trustedSecurityPatch)) {
    throw new TypeError('trusted security patch must be an absolute path')
  }

  const args: string[] = [
    '--profile',
    options.profile,
    '--patch',
    options.trustedSecurityPatch,
  ]
  args.push('--host', '127.0.0.1', '--port', '0', '--no-open')
  return Object.freeze(args)
}

export function parseDesktopLaunchOptions(
  argv: readonly string[],
): DesktopLaunchOptions {
  let profile: DesktopProfile = 'default'

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--profile') {
      const value = argv[index + 1]
      if (value === undefined || !isDesktopProfile(value)) {
        throw new TypeError('--profile must be default or compatibility')
      }
      profile = value
      index += 1
      continue
    }
    if (argument === '--patch' || argument?.startsWith('--patch=') === true) {
      throw new TypeError('desktop launch does not allow external patches')
    }
  }

  return Object.freeze({ profile })
}

export function childEnvironment(
  base: NodeJS.ProcessEnv,
  token: string,
  paths: DesktopPaths,
  profile: DesktopProfile,
): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _forbidden, ...safeBase } = base
  return {
    ...safeBase,
    [CONTROL_TOKEN_ENV]: token,
    [PROFILE_ENV]: profile,
    DSH_HOME: paths.harnessHome,
    CONVAX_PROJECTS_HOME: paths.projectsHome,
  }
}
