import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { createProfileDataParser } from './profile-core.mjs'

export const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const PROFILE_NAMES = Object.freeze(['compatibility', 'default'])
export const TRUSTED_SECURITY_PATCH = join(REPOSITORY_ROOT, 'app', 'profiles', 'security.patch.yml')
const DESKTOP_PACKAGE_ROOT = join(REPOSITORY_ROOT, 'app', 'desktop')
const desktopRequire = createRequire(join(DESKTOP_PACKAGE_ROOT, 'package.json'))
const desktopManifest = JSON.parse(readFileSync(join(DESKTOP_PACKAGE_ROOT, 'package.json'), 'utf8'))
const profileDataParser = createProfileDataParser(source => YAML.parse(source))

function profileSource(name) {
  if (!PROFILE_NAMES.includes(name)) throw new Error(`unknown product profile ${JSON.stringify(name)}`)
  return join(REPOSITORY_ROOT, 'app', 'profiles', name)
}

function replaceFile(path, contents) {
  writeFileSync(path, contents.endsWith('\n') ? contents : `${contents}\n`)
}

export const parsePureDataPatches = profileDataParser.parsePureDataPatches
export const profilePackageNames = profileDataParser.profilePackageNames

function resolvePackageManifest(packageName) {
  try {
    return desktopRequire.resolve(`${packageName}/package.json`)
  } catch {
    let cursor = dirname(desktopRequire.resolve(packageName))
    const root = parse(cursor).root
    while (cursor !== root) {
      const candidate = join(cursor, 'package.json')
      try {
        if (JSON.parse(readFileSync(candidate, 'utf8')).name === packageName) return candidate
      } catch {
        // Continue walking for packages that export-hide package.json.
      }
      cursor = dirname(cursor)
    }
    throw new Error(`unable to locate package manifest for ${packageName}`)
  }
}

function productPackageDirectory(packageName) {
  if (packageName === '@convax/desktop') return DESKTOP_PACKAGE_ROOT
  if (!Object.hasOwn(desktopManifest.dependencies ?? {}, packageName)) {
    throw new Error(`profile package ${packageName} must be installed by @convax/desktop`)
  }
  return dirname(resolvePackageManifest(packageName))
}

function ensureLink(link, target) {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`refusing to replace non-symlink product package path ${link}`)
    }
    if (resolve(dirname(link), readlinkSync(link)) === target) return
    unlinkSync(link)
  }
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Materialize the checked-in product profile and local package links. */
export function provisionProfile(home, name) {
  const source = profileSource(name)
  const profiles = join(home, 'profiles')
  const target = join(profiles, name)
  mkdirSync(target, { recursive: true })

  const patchSource = readFileSync(join(source, 'cordis.patch.yml'), 'utf8')
  replaceFile(join(target, 'package.json'), readFileSync(join(source, 'package.json'), 'utf8'))
  replaceFile(join(target, 'cordis.patch.yml'), patchSource)
  replaceFile(join(target, 'cordis.yml'), '[]\n')
  replaceFile(join(target, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')

  const modules = join(profiles, 'node_modules')
  mkdirSync(modules, { recursive: true })
  for (const packageName of profilePackageNames(patchSource)) {
    const packageDir = productPackageDirectory(packageName)
    if (!existsSync(join(packageDir, 'package.json'))) {
      throw new Error(`profile package ${packageName} has no package.json`)
    }
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    if (manifest.name !== packageName) {
      throw new Error(`profile package target for ${packageName} declares ${String(manifest.name)}`)
    }
    const link = join(modules, ...packageName.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    ensureLink(link, packageDir)
  }
  return target
}

export function provisionAllProfiles(home) {
  for (const name of PROFILE_NAMES) provisionProfile(home, name)
}

export function dshBinPath() {
  // Resolve through the desktop deploy root: its explicit dependencies are
  // the same closure Electron Builder carries into the application.
  const require = createRequire(join(REPOSITORY_ROOT, 'app', 'desktop', 'package.json'))
  const manifest = require.resolve('@deepseek-ai/dsh/package.json')
  return join(dirname(manifest), 'lib', 'bin.js')
}

export function packagedNodeBinPath() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(`Convax Comic packages Node only for darwin-arm64; received ${process.platform}-${process.arch}`)
  }
  const require = createRequire(join(REPOSITORY_ROOT, 'app', 'desktop', 'package.json'))
  const manifestPath = require.resolve('node-bin-darwin-arm64/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.node
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new Error('node-bin-darwin-arm64 does not expose bin node')
  }
  return join(dirname(manifestPath), relative)
}

export function profileLaunchArgs(profile, trustedSecurityPatch = TRUSTED_SECURITY_PATCH) {
  if (!PROFILE_NAMES.includes(profile)) throw new Error(`unknown product profile ${JSON.stringify(profile)}`)
  if (!isAbsolute(trustedSecurityPatch)) throw new Error('trusted security patch must be an absolute path')
  parsePureDataPatches(readFileSync(trustedSecurityPatch, 'utf8'))
  const launcher = ['--profile', profile, '--patch', trustedSecurityPatch]
  return [...launcher, '--host', '127.0.0.1', '--port', '0', '--no-open']
}
