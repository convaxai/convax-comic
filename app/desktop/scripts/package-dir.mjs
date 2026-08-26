import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const builderCli = require.resolve('electron-builder/cli.js')
const { ELECTRON_RUN_AS_NODE: _forbidden, ...safeEnvironment } = process.env
const result = spawnSync(process.execPath, [builderCli, '--dir', '--mac', '--arm64'], {
  cwd: packageRoot,
  env: {
    ...safeEnvironment,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error(`electron-builder exited with ${String(result.status)}`)

const packagedNode = join(
  packageRoot,
  'dist',
  'mac-arm64',
  'Convax Comic.app',
  'Contents',
  'Resources',
  'app',
  'node_modules',
  'node-bin-darwin-arm64',
  'bin',
  'node',
)
if (!existsSync(packagedNode)) throw new Error('packaged independent Node binary is missing')

const resourcesRoot = join(
  packageRoot,
  'dist',
  'mac-arm64',
  'Convax Comic.app',
  'Contents',
  'Resources',
)
const packagedAppRoot = join(resourcesRoot, 'app')
if (!existsSync(packagedAppRoot) || existsSync(join(resourcesRoot, 'app.asar'))) {
  throw new Error('packaged external Node closure must live outside app.asar')
}
if (!existsSync(join(resourcesRoot, 'profiles', 'security.patch.yml'))) {
  throw new Error('packaged trusted security overlay is missing')
}
for (const profile of ['default', 'compatibility']) {
  for (const file of ['package.json', 'cordis.patch.yml']) {
    if (!existsSync(join(resourcesRoot, 'profiles', profile, file))) {
      throw new Error(`packaged profile resource is missing: ${profile}/${file}`)
    }
  }
}
const profilePackages = new Set()
for (const profile of ['default', 'compatibility']) {
  const patch = YAML.parse(readFileSync(join(resourcesRoot, 'profiles', profile, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error(`packaged ${profile} patch root is not an array`)
  for (const row of patch.flatMap(entry => Array.isArray(entry?.insert) ? entry.insert : [])) {
    if (typeof row?.name !== 'string' || !PACKAGE_NAME.test(row.name)) {
      throw new Error(`packaged ${profile} patch contains an invalid package name`)
    }
    profilePackages.add(row.name)
  }
}
for (const packageName of profilePackages) {
  if (packageName === '@convax/desktop') continue
  if (!existsSync(join(packagedAppRoot, 'node_modules', ...packageName.split('/'), 'package.json'))) {
    throw new Error(`packaged product dependency is missing: ${packageName}`)
  }
}
if (!existsSync(join(packagedAppRoot, 'lib', 'plugin.js'))) {
  throw new Error('packaged @convax/desktop Host plugin is missing from Resources/app')
}
if (!existsSync(join(packagedAppRoot, 'lib', 'parent-guard.cjs'))) {
  throw new Error('packaged parent lifetime guard is missing from Resources/app')
}
const packagedDshCli = join(
  packagedAppRoot,
  'node_modules',
  '@deepseek-ai',
  'dsh',
  'lib',
  'bin.js',
)
if (!existsSync(packagedDshCli)) throw new Error('packaged DSH CLI is missing from Resources/app')
const version = execFileSync(packagedNode, ['--version'], { encoding: 'utf8' }).trim()
if (version !== 'v24.9.0') throw new Error(`packaged runtime is ${version}, expected v24.9.0`)
const pluginEntrypoint = join(packagedAppRoot, 'lib', 'plugin.js')
const pluginProbe = spawnSync(packagedNode, [
  '--input-type=module',
  '--eval',
  `await import(${JSON.stringify(pathToFileURL(pluginEntrypoint).href)})`,
], {
  env: safeEnvironment,
  stdio: 'pipe',
})
if (pluginProbe.error !== undefined) throw pluginProbe.error
if (pluginProbe.status !== 0) {
  throw new Error('packaged @convax/desktop Host plugin cannot load under independent Node')
}
const packagedSmoke = spawnSync(process.execPath, [
  fileURLToPath(new URL('./packaged-smoke.mjs', import.meta.url)),
  resourcesRoot,
], {
  env: safeEnvironment,
  stdio: 'inherit',
})
if (packagedSmoke.error !== undefined) throw packagedSmoke.error
if (packagedSmoke.status !== 0) throw new Error('packaged runtime smoke failed')
process.stdout.write('unsigned macOS ARM64 directory and independent Node verified\n')
