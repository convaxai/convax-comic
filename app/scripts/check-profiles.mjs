import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { PROFILE_NAMES, REPOSITORY_ROOT } from './profile-runtime.mjs'

function fail(message) {
  throw new Error(`profile gate: ${message}`)
}

const CANONICAL_EXTERNAL_ROWS = new Map([
  ['llm-openai-codex', 'dsh-codex-connect'],
])

function assertNoExecutableExpressions(value, label, path = '$') {
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, '__jsExpr')) fail(`${label} contains an executable expression at ${path}`)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoExecutableExpressions(entry, label, `${path}[${String(index)}]`))
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoExecutableExpressions(entry, label, `${path}.${key}`)
  }
}

const desktopManifest = JSON.parse(readFileSync(
  join(REPOSITORY_ROOT, 'app', 'desktop', 'package.json'),
  'utf8',
))
const yarnConfig = YAML.parse(readFileSync(join(REPOSITORY_ROOT, '.yarnrc.yml'), 'utf8'))
const installedProfilePackages = new Set([
  '@convax/desktop',
  ...Object.keys(desktopManifest.dependencies ?? {}),
])
const SECURITY_IDS = [
  'webserver',
  'web-runtime',
  'sandbox-policy',
  'approval',
  'permission',
  'agent-presets',
  'app-agent-presets',
  'app-auth-fence',
  'app-command-guard',
]

function inspect(name) {
  const path = join(REPOSITORY_ROOT, 'app', 'profiles', name, 'cordis.patch.yml')
  const raw = readFileSync(path, 'utf8')
  if (/!!js|process\.env|\bctx\./u.test(raw)) fail(`${name} contains executable configuration`)
  const patches = YAML.parse(raw)
  if (!Array.isArray(patches)) fail(`${name} patch root is not an array`)
  assertNoExecutableExpressions(patches, name)

  const inserted = patches.flatMap(patch => Array.isArray(patch?.insert) ? patch.insert : [])
  const ids = inserted.map(row => row?.id)
  if (inserted.some(row => typeof row?.id !== 'string'
    || (!row.id.startsWith('app-') && CANONICAL_EXTERNAL_ROWS.get(row.id) !== row.name))) {
    fail(`${name} has a product row outside app-* or an unrecognized canonical external row`)
  }
  if (new Set(ids).size !== ids.length) fail(`${name} has duplicate inserted ids`)
  for (const row of inserted) {
    if (typeof row?.name !== 'string' || !installedProfilePackages.has(row.name)) {
      fail(`${name} inserts package ${String(row?.name)} without installing it in @convax/desktop`)
    }
  }

  const byId = new Map(patches.filter(patch => typeof patch?.id === 'string').map(patch => [patch.id, patch]))
  const insertedById = new Map(inserted.map(row => [row.id, row]))
  if (byId.get('webserver')?.disabled !== true) fail(`${name} does not disable the unauthenticated upstream webserver`)
  if (insertedById.get('app-auth-fence')?.name !== '@convax/auth-fence') fail(`${name} does not mount auth-fence`)
  if (byId.get('agent-presets')?.disabled !== true) fail(`${name} does not disable the unrestricted upstream preset roster`)
  if (insertedById.get('app-agent-presets')?.name !== '@convax/agent-presets') fail(`${name} does not mount the product preset policy`)
  if (insertedById.get('app-command-guard')?.name !== '@convax/command-guard') fail(`${name} does not mount command-guard`)
  if (insertedById.get('app-desktop-host')?.name !== '@convax/desktop') fail(`${name} does not mount the desktop Host plugin`)

  const permission = byId.get('permission')?.config
  const permissionText = JSON.stringify(permission)
  if (permission?.defaultPreset !== 'workspace-write' || permissionText.includes('danger-full-access')) {
    fail(`${name} permission posture is not the conservative product table`)
  }
  if (byId.get('sandbox-policy')?.config?.mode !== 'workspace-write') fail(`${name} sandbox policy is not workspace-write`)
  if (byId.get('approval')?.config?.policy !== 'ask') fail(`${name} approval policy is not ask`)

  return { byId, insertedById }
}

const compatibility = inspect('compatibility')
const defaultProfile = inspect('default')

const securityPath = join(REPOSITORY_ROOT, 'app', 'profiles', 'security.patch.yml')
const securityRaw = readFileSync(securityPath, 'utf8')
if (/!!js|process\.env|\bctx\./u.test(securityRaw)) fail('trusted security overlay contains executable configuration')
const securityPatches = YAML.parse(securityRaw)
if (!Array.isArray(securityPatches)) fail('trusted security overlay root is not an array')
assertNoExecutableExpressions(securityPatches, 'trusted security overlay')
if (securityPatches.some(patch => patch?.insert !== undefined)) {
  fail('trusted security overlay may only reassert existing product rows')
}
const securityById = new Map(securityPatches.map(patch => [patch?.id, patch]))
if (securityById.size !== securityPatches.length) fail('trusted security overlay has duplicate ids')
if (JSON.stringify([...securityById.keys()]) !== JSON.stringify(SECURITY_IDS)) {
  fail('trusted security overlay has an unexpected row set or order')
}

const secureWebserver = securityById.get('webserver')
if (secureWebserver?.name !== '@deepseek-ai/dsh-host-webserver'
  || secureWebserver.disabled !== true
  || secureWebserver.config?.host !== '127.0.0.1'
  || secureWebserver.config?.port !== 0) {
  fail('trusted security overlay does not disable the canonical upstream webserver')
}
const secureWebRuntime = securityById.get('web-runtime')
if (secureWebRuntime?.name !== '@deepseek-ai/dsh-web-app'
  || secureWebRuntime.config?.openBrowser !== false
  || secureWebRuntime.config?.printUrl !== false
  || secureWebRuntime.config?.surfaceContext !== true
  || !Array.isArray(secureWebRuntime.config?.trustedHosts)
  || secureWebRuntime.config.trustedHosts.length !== 0) {
  fail('trusted security overlay does not constrain the Web runtime')
}
const secureFence = securityById.get('app-auth-fence')
if (secureFence?.name !== '@convax/auth-fence'
  || secureFence.disabled !== false
  || JSON.stringify(secureFence.inject) !== JSON.stringify(['webStartup'])
  || secureFence.config?.host !== '127.0.0.1'
  || secureFence.config?.port !== 0) {
  fail('trusted security overlay does not reassert auth-fence')
}
if (securityById.get('agent-presets')?.name !== '@deepseek-ai/dsh-agent-presets'
  || securityById.get('agent-presets')?.disabled !== true
  || securityById.get('app-agent-presets')?.name !== '@convax/agent-presets'
  || securityById.get('app-agent-presets')?.disabled !== false
  || securityById.get('app-agent-presets')?.config?.default !== 'standard') {
  fail('trusted security overlay does not enforce the product Agent preset roster')
}
if (securityById.get('app-command-guard')?.name !== '@convax/command-guard'
  || securityById.get('app-command-guard')?.disabled !== false) {
  fail('trusted security overlay does not reassert command-guard')
}
const securePermission = securityById.get('permission')?.config
if (securityById.get('sandbox-policy')?.config?.mode !== 'workspace-write'
  || securityById.get('approval')?.config?.policy !== 'ask'
  || securePermission?.defaultPreset !== 'workspace-write'
  || JSON.stringify(securePermission).includes('danger-full-access')) {
  fail('trusted security overlay does not reassert the conservative permission posture')
}

if ([...compatibility.byId.keys()].some(id => id.startsWith('ui-'))) {
  fail('compatibility modifies an upstream UI row')
}
const PRODUCT_CLIENT_PACKAGES = new Set(['@convax/ui', '@convax/project', '@convax/canvas', '@convax/canvas-builtins', 'dsh-codex-connect'])
if (compatibility.insertedById.get('app-sqlite-runtime')?.name !== '@convax/sqlite-runtime') {
  fail('compatibility does not mount the shared Host-only SQLite runtime')
}
if ([...compatibility.insertedById.values()].some(row => PRODUCT_CLIENT_PACKAGES.has(row.name))) {
  fail('compatibility mounts a product Client UI')
}
if (defaultProfile.byId.get('ui-brand-official')?.disabled !== true) {
  fail('default does not release the official brand slots')
}
if (defaultProfile.byId.get('ui-layout')?.disabled !== true) {
  fail('default does not release the root slot for the product workbench')
}
if (defaultProfile.byId.has('ui-sidebar')) {
  fail('default overrides the official DSH sidebar shell')
}
if (defaultProfile.byId.get('ui-workspace')?.disabled !== true) {
  fail('default does not release sidebar.workspaces for the product navigator')
}
for (const [id, packageName] of [
  ['app-runtime', '@convax/runtime'],
  ['app-ui', '@convax/ui'],
  ['app-project', '@convax/project'],
  ['app-sqlite-runtime', '@convax/sqlite-runtime'],
  ['app-canvas-store-sqlite', '@convax/canvas-store-sqlite'],
  ['app-canvas', '@convax/canvas'],
  ['app-canvas-builtins', '@convax/canvas-builtins'],
]) {
  if (defaultProfile.insertedById.get(id)?.name !== packageName) fail(`default is missing ${id}`)
}
const codexConnect = defaultProfile.insertedById.get('llm-openai-codex')
if (codexConnect?.name !== 'dsh-codex-connect'
  || JSON.stringify(codexConnect.config) !== JSON.stringify({
    enableProxy: false,
    enableSearch: true,
    enableImageTool: true,
    enableImageGeneration: true,
  })) {
  fail('default does not mount Codex Connect with the approved optional capabilities')
}
if (desktopManifest.dependencies?.['dsh-codex-connect'] !== '0.1.0-alpha.4.20'
  || desktopManifest.dependencies?.['@earendil-works/pi-ai'] !== '0.82.1'
  || desktopManifest.dependencies?.['@deepseek-ai/dsh-llm-pi-ai'] !== '0.1.1-rc.2') {
  fail('Codex Connect or its verified runtime peers are not exactly pinned')
}
if (JSON.stringify(yarnConfig.npmPreapprovedPackages)
    !== JSON.stringify(['dsh-codex-connect@0.1.0-alpha.4.20'])
  || yarnConfig.approvedGitRepositories !== undefined) {
  fail('Codex Connect supply-chain exception is not limited to its exact npm descriptor')
}

for (const name of PROFILE_NAMES) {
  const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'app', 'profiles', name, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles
  if (JSON.stringify(bundles) !== JSON.stringify(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])) {
    fail(`${name} changes the upstream base/Web bundle order`)
  }
}

process.stdout.write('profile gate: compatibility/default composition contracts pass\n')
