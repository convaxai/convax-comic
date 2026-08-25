import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  assertPureDataPatchSource,
  materializeProductProfile,
  profilePackageNames,
  resolveProfileSourceRoot,
  resolveProductPackageTargets,
  type ProductPackageTargets,
} from '../src/profile-materializer.js'

describe('named profile materialization', () => {
  it('copies the canonical profile and links every product package into the shared fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'convax-profile-'))
    try {
      const sourceProfilesRoot = join(root, 'source-profiles')
      const sourceProfile = join(sourceProfilesRoot, 'default')
      const harnessHome = join(root, 'user-data', 'harness')
      await mkdir(sourceProfile, { recursive: true })
      const manifest = '{"name":"convax-profile-default","private":true}\n'
      const packageNames = ['@convax/desktop', '@example/ordinary-plugin']
      const patch = `- insert:\n${packageNames.map(name => `    - name: '${name}'`).join('\n')}\n`
      await writeFile(join(sourceProfile, 'package.json'), manifest)
      await writeFile(join(sourceProfile, 'cordis.patch.yml'), patch)

      const entries = await Promise.all(packageNames.map(async (packageName) => {
        const packageRoot = join(root, 'runtime-packages', packageName.replace('@', '').replace('/', '-'))
        await mkdir(packageRoot, { recursive: true })
        await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: packageName }))
        return [packageName, packageRoot] as const
      }))
      const packageTargets = Object.fromEntries(entries) as ProductPackageTargets

      await materializeProductProfile({
        profile: 'default',
        sourceProfilesRoot,
        harnessHome,
        packageTargets,
      })

      const targetProfile = join(harnessHome, 'profiles', 'default')
      expect(await readFile(join(targetProfile, 'package.json'), 'utf8')).toBe(manifest)
      expect(await readFile(join(targetProfile, 'cordis.patch.yml'), 'utf8')).toBe(patch)
      for (const packageName of packageNames) {
        const link = join(harnessHome, 'profiles', 'node_modules', ...packageName.split('/'))
        expect((await lstat(link)).isSymbolicLink()).toBe(true)
        expect(resolve(join(link, '..'), await readlink(link))).toBe(resolve(packageTargets[packageName]!))
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('derives ordinary package links from pure-data insert rows', () => {
    expect(profilePackageNames(`
- insert:
    - id: app-desktop-host
      name: '@convax/desktop'
    - id: third-party
      name: 'ordinary-cordis-plugin'
    - id: duplicate
      name: 'ordinary-cordis-plugin'
`)).toEqual(['@convax/desktop', 'ordinary-cordis-plugin'])
    expect(() => profilePackageNames('- insert:\n    - name: ../../escape\n')).toThrow(/invalid package name/)
    expect(() => assertPureDataPatchSource('- id: x\n  config: { __jsExpr: process.env.SECRET }\n'))
      .toThrow(/executable expression/)
    expect(() => assertPureDataPatchSource('- id: x\n  disabled: !!js process.platform\n'))
      .toThrow(/executable !!js/)
  })

  it('requires each non-desktop profile package to be an installed dependency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'convax-deploy-root-'))
    try {
      await writeFile(join(root, 'package.json'), '{"dependencies":{}}\n')
      expect(resolveProductPackageTargets(root, ['@convax/desktop']))
        .toEqual({ '@convax/desktop': root })
      expect(() => resolveProductPackageTargets(root, ['ordinary-cordis-plugin']))
        .toThrow(/must be installed/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves canonical sources differently in development and packaged apps', () => {
    expect(resolveProfileSourceRoot({
      packaged: false,
      resourcesPath: '/Applications/Convax.app/Contents/Resources',
      desktopPackageRoot: '/repo/app/desktop',
    })).toBe('/repo/app/profiles')
    expect(resolveProfileSourceRoot({
      packaged: true,
      resourcesPath: '/Applications/Convax.app/Contents/Resources',
      desktopPackageRoot: '/ignored/app.asar',
    })).toBe('/Applications/Convax.app/Contents/Resources/profiles')
  })
})
