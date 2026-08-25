import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  unlink,
} from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { isDesktopProfile } from './profile-args.js'
import { resolvePackageDirectory } from './runtime-paths.js'
import type { DesktopProfile } from './types.js'

export type ProductPackageTargets = Readonly<Record<string, string>>

export interface MaterializeProfileOptions {
  readonly profile: DesktopProfile
  readonly sourceProfilesRoot: string
  readonly harnessHome: string
  readonly packageTargets: ProductPackageTargets
}

export interface ProfileSourceOptions {
  readonly packaged: boolean
  readonly resourcesPath: string
  readonly desktopPackageRoot: string
}

export function resolveProfileSourceRoot(options: ProfileSourceOptions): string {
  return options.packaged
    ? join(options.resourcesPath, 'profiles')
    : resolve(options.desktopPackageRoot, '..', 'profiles')
}

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

function assertNoExecutableExpressions(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, '__jsExpr')) {
    throw new TypeError(`product patch contains an executable expression at ${path}`)
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutableExpressions(entry, `${path}[${String(index)}]`))
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoExecutableExpressions(entry, `${path}.${key}`)
  }
}

export function assertPureDataPatchSource(patchSource: string): readonly unknown[] {
  if (/!!js\b/u.test(patchSource)) {
    throw new TypeError('product patch contains an executable !!js tag')
  }
  const patches: unknown = YAML.parse(patchSource)
  if (!Array.isArray(patches)) throw new TypeError('profile patch root must be an array')
  assertNoExecutableExpressions(patches)
  return patches
}

export function profilePackageNames(patchSource: string): readonly string[] {
  const patches = assertPureDataPatchSource(patchSource)
  const names: string[] = []
  for (const patch of patches) {
    if (patch === null || typeof patch !== 'object') continue
    const inserted = (patch as { insert?: unknown }).insert
    if (!Array.isArray(inserted)) continue
    for (const row of inserted) {
      const name = row !== null && typeof row === 'object'
        ? (row as { name?: unknown }).name
        : undefined
      if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) {
        throw new TypeError(`profile insert has an invalid package name: ${String(name)}`)
      }
      if (!names.includes(name)) names.push(name)
    }
  }
  return Object.freeze(names)
}

export function resolveProductPackageTargets(
  desktopPackageRoot: string,
  packageNames: readonly string[],
): ProductPackageTargets {
  const manifest = JSON.parse(
    readFileSync(join(desktopPackageRoot, 'package.json'), 'utf8'),
  ) as { dependencies?: Readonly<Record<string, string>> }
  const dependencies = manifest.dependencies ?? {}
  const targets: Record<string, string> = {}
  for (const packageName of packageNames) {
    if (!PACKAGE_NAME.test(packageName)) throw new TypeError(`invalid product package name: ${packageName}`)
    if (packageName === '@convax/desktop') {
      targets[packageName] = desktopPackageRoot
      continue
    }
    if (!Object.hasOwn(dependencies, packageName)) {
      throw new Error(`profile package ${packageName} must be installed by @convax/desktop`)
    }
    targets[packageName] = resolvePackageDirectory(packageName)
  }
  return Object.freeze(targets)
}

export async function materializeProductProfile(options: MaterializeProfileOptions): Promise<void> {
  if (!isDesktopProfile(options.profile)) {
    throw new TypeError(`unsupported desktop profile: ${String(options.profile)}`)
  }
  const sourceDir = join(options.sourceProfilesRoot, options.profile)
  const targetDir = join(options.harnessHome, 'profiles', options.profile)
  const patchSource = await readFile(join(sourceDir, 'cordis.patch.yml'), 'utf8')
  const packageNames = profilePackageNames(patchSource)
  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await Promise.all([
    copyFile(join(sourceDir, 'package.json'), join(targetDir, 'package.json')),
    copyFile(join(sourceDir, 'cordis.patch.yml'), join(targetDir, 'cordis.patch.yml')),
  ])

  const modulesRoot = join(options.harnessHome, 'profiles', 'node_modules')
  for (const packageName of packageNames) {
    const unresolvedTarget = options.packageTargets[packageName]
    if (unresolvedTarget === undefined) throw new Error(`missing package target for ${packageName}`)
    const target = resolve(unresolvedTarget)
    const manifestPath = join(target, 'package.json')
    await access(manifestPath)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: unknown }
    if (manifest.name !== packageName) {
      throw new Error(`package target for ${packageName} declares ${String(manifest.name)}`)
    }
    const link = join(modulesRoot, ...packageName.split('/'))
    await ensurePackageLink(link, target)
  }
}

async function ensurePackageLink(link: string, target: string): Promise<void> {
  await mkdir(dirname(link), { recursive: true, mode: 0o700 })
  try {
    const stat = await lstat(link)
    if (!stat.isSymbolicLink()) {
      throw new Error(`${link} exists and is not a product-managed package link`)
    }
    if (resolve(dirname(link), await readlink(link)) === target) return
    await unlink(link)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await symlink(target, link, 'junction')
}
