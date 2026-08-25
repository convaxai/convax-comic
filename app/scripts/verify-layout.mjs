import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { REPOSITORY_ROOT } from './profile-runtime.mjs'

function fail(message) {
  throw new Error(`layout gate: ${message}`)
}

function git(args, cwd = REPOSITORY_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

const upstream = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'upstream.json'), 'utf8'))
const gitlink = git(['rev-parse', 'HEAD:deepseek-harness'])
const checkout = git(['rev-parse', 'HEAD'], join(REPOSITORY_ROOT, 'deepseek-harness'))
if (gitlink !== upstream.commit || checkout !== upstream.commit) {
  fail(`submodule pin mismatch: manifest=${upstream.commit}, gitlink=${gitlink}, checkout=${checkout}`)
}
const dirtyUpstream = git(['status', '--porcelain', '--untracked-files=no'], join(REPOSITORY_ROOT, 'deepseek-harness'))
if (dirtyUpstream !== '') fail('deepseek-harness has tracked modifications')

const rootManifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'))
if (rootManifest.dependencies?.['@deepseek-ai/dsh'] !== upstream.version) fail('npm DSH runtime is not pinned to upstream version')

const desktopManifestPath = join(REPOSITORY_ROOT, 'app', 'desktop', 'package.json')
if (!existsSync(desktopManifestPath)) fail('desktop package is missing')
const desktop = JSON.parse(readFileSync(desktopManifestPath, 'utf8'))
const allDesktopDeps = { ...desktop.dependencies, ...desktop.devDependencies }
if (allDesktopDeps.electron !== '43.4.0') fail('Electron must be exactly 43.4.0')
if (allDesktopDeps['node-bin-darwin-arm64'] !== '24.9.0') {
  fail('packaged Darwin ARM64 Node must be exactly 24.9.0')
}
if (allDesktopDeps.node !== undefined) fail('generic node installer package is forbidden')
if (desktop.build?.asar !== false) {
  fail('M1 external Node runtime must not live under an app.asar path')
}

const lock = YAML.parse(readFileSync(join(REPOSITORY_ROOT, 'yarn.lock'), 'utf8'))
const dshResolutions = Object.values(lock)
  .filter(entry => entry !== null
    && typeof entry === 'object'
    && typeof entry.resolution === 'string'
    && entry.resolution.startsWith('@deepseek-ai/dsh'))
  .map(entry => entry.resolution)
const driftingDsh = dshResolutions.filter(resolution => !resolution.endsWith(`@npm:${upstream.version}`))
if (dshResolutions.length < 100 || driftingDsh.length !== 0) {
  fail(`DSH npm closure drifted from ${upstream.version}: ${driftingDsh.join(', ')}`)
}

const patchFiles = readdirSync(join(REPOSITORY_ROOT, 'patches')).filter(name => name.endsWith('.patch'))
if (patchFiles.length !== 0 || upstream.patches.length !== 0) fail('M1 patch inventory must remain empty')

for (const path of [
  'app/profiles/compatibility/cordis.patch.yml',
  'app/profiles/default/cordis.patch.yml',
  'app/profiles/security.patch.yml',
]) {
  const raw = readFileSync(join(REPOSITORY_ROOT, path), 'utf8')
  if (raw.includes('!!js') || raw.includes('__jsExpr')) fail(`${path} contains executable YAML`)
}

process.stdout.write('layout gate: upstream pin, runtime versions, patches, and config purity pass\n')
