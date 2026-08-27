import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  dshBinPath,
  packagedNodeBinPath,
  profilePackageNames,
  provisionProfile,
  REPOSITORY_ROOT,
  TRUSTED_SECURITY_PATCH,
} from './profile-runtime.mjs'

const BASELINE_PROFILE = 'upstream-baseline'
const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const PRODUCT_SHARED_CHANGES = new Set([
  'webserver',
  'web-runtime',
  'sandbox-policy',
  'approval',
  'permission',
  'agent-presets',
])

function fail(message) {
  throw new Error(`dump-config gate: ${message}`)
}

function provisionBaseline(home) {
  const profile = join(home, 'profiles', BASELINE_PROFILE)
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
    name: 'convax-upstream-baseline',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: BUNDLES } },
  }, null, 2)}\n`)
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
}

function dump(home, profile, trusted = false) {
  const args = [
    dshBinPath(),
    '--profile',
    profile,
  ]
  if (trusted) args.push('--patch', TRUSTED_SECURITY_PATCH)
  args.push('--dump-config')
  const result = spawnSync(packagedNodeBinPath(), args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1',
    },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) fail(`${profile} dump failed:\n${result.stderr}`)
  if (result.stderr.trim() !== '') fail(`${profile} dump emitted warnings:\n${result.stderr}`)
  return result.stdout.replaceAll(home, '$DSH_HOME')
}

function expectedProfileAdditions(profile) {
  const source = readFileSync(join(REPOSITORY_ROOT, 'app', 'profiles', profile, 'cordis.patch.yml'), 'utf8')
  const packageNames = new Set(profilePackageNames(source))
  const patches = YAML.parse(source)
  return patches.flatMap(patch => Array.isArray(patch?.insert) ? patch.insert : [])
    .filter(row => packageNames.has(row?.name))
    .map(row => row.id)
}

function parseRows(output) {
  const lines = output.split(/\r?\n/u)
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^- id: /u.test(lines[index] ?? '')) starts.push(index)
  }
  const rows = new Map()
  const order = []
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index]
    const end = starts[index + 1] ?? lines.length
    const id = (lines[start] ?? '').slice('- id: '.length).trim()
    const block = lines.slice(start, end)
      .filter(line => !line.startsWith('#'))
      .join('\n')
      .trim()
    if (rows.has(id)) fail(`duplicate flattened row ${id}`)
    rows.set(id, block)
    order.push(id)
  }
  return { order, rows }
}

function assertOnlyDisabled(baseline, product, id) {
  const baselineRow = YAML.parse(baseline.rows.get(id))?.[0]
  const productRow = YAML.parse(product.rows.get(id))?.[0]
  if (productRow?.disabled !== true) fail(`default ${id} is not disabled`)
  delete productRow.disabled
  delete baselineRow.disabled
  if (JSON.stringify(productRow) !== JSON.stringify(baselineRow)) {
    fail(`default ${id} changes more than its disabled state`)
  }
}

function compareProfile(baselineOutput, productOutput, profile) {
  const baseline = parseRows(baselineOutput)
  const product = parseRows(productOutput)
  const expectedAdditions = expectedProfileAdditions(profile)
  const allowedChanges = new Set(PRODUCT_SHARED_CHANGES)
  if (profile === 'default') {
    allowedChanges.add('ui-brand-official')
    allowedChanges.add('ui-layout')
    allowedChanges.add('ui-workspace')
  }

  const missing = baseline.order.filter(id => !product.rows.has(id))
  if (missing.length !== 0) fail(`${profile} removed upstream rows: ${missing.join(', ')}`)
  const additions = product.order.filter(id => !baseline.rows.has(id))
  if (JSON.stringify(additions) !== JSON.stringify(expectedAdditions)) {
    fail(`${profile} additions are ${JSON.stringify(additions)}, expected ${JSON.stringify(expectedAdditions)}`)
  }
  const commonOrder = product.order.filter(id => baseline.rows.has(id))
  if (JSON.stringify(commonOrder) !== JSON.stringify(baseline.order)) {
    fail(`${profile} reordered the upstream tree`)
  }

  const changed = baseline.order.filter(id => baseline.rows.get(id) !== product.rows.get(id))
  const unexpected = changed.filter(id => !allowedChanges.has(id))
  const absentExpected = [...allowedChanges].filter(id => !changed.includes(id))
  if (unexpected.length !== 0) fail(`${profile} unexpectedly changed rows: ${unexpected.join(', ')}`)
  if (absentExpected.length !== 0) fail(`${profile} expected changes are absent: ${absentExpected.join(', ')}`)

  if (profile === 'compatibility') {
    for (const id of baseline.order.filter(id => /^(?:client-|modules$|connection$|api-remotes$|ui-)/u.test(id))) {
      if (baseline.rows.get(id) !== product.rows.get(id)) fail(`compatibility overrides client row ${id}`)
    }
  } else {
    for (const id of ['ui-brand-official', 'ui-layout', 'ui-workspace']) {
      assertOnlyDisabled(baseline, product, id)
    }
    const consumer = product.order.indexOf('app-test-consumer')
    const provider = product.order.indexOf('app-runtime')
    if (consumer === -1 || provider === -1 || consumer >= provider) {
      fail('default does not exercise consumer-before-provider ordering')
    }
  }
  return changed
}

function digest(output) {
  return createHash('sha256').update(output).digest('hex').slice(0, 12)
}

const root = mkdtempSync(join(tmpdir(), 'convax-dump-gate-'))
try {
  provisionBaseline(root)
  provisionProfile(root, 'compatibility')
  provisionProfile(root, 'default')
  const baseline = dump(root, BASELINE_PROFILE)
  writeFileSync(join(root, 'cordis.patch.yml'), [
    '# Simulate a writable home layer attempting to weaken product security.',
    '- id: webserver',
    '  disabled: false',
    '  config:',
    '    host: 0.0.0.0',
    '    port: 0',
    '- id: sandbox-policy',
    '  config:',
    '    mode: danger-full-access',
    '- id: approval',
    '  config:',
    '    policy: never',
    '- id: permission',
    '  config:',
    '    defaultPreset: danger-full-access',
    '    presets: {}',
    '- id: app-auth-fence',
    '  disabled: true',
    '- id: app-command-guard',
    '  disabled: true',
    '- id: agent-presets',
    '  disabled: false',
    '- id: app-agent-presets',
    '  disabled: true',
    '',
  ].join('\n'))
  const compatibility = dump(root, 'compatibility', true)
  const defaultProfile = dump(root, 'default', true)
  const compatibilityChanges = compareProfile(baseline, compatibility, 'compatibility')
  const defaultChanges = compareProfile(baseline, defaultProfile, 'default')
  process.stdout.write([
    'dump-config gate: upstream baseline diff is fully explained',
    `baseline=${digest(baseline)}`,
    `compatibility=${digest(compatibility)}[${compatibilityChanges.join(',')}]`,
    `default=${digest(defaultProfile)}[${defaultChanges.join(',')}]`,
    '\n',
  ].join(' '))
} finally {
  rmSync(root, { recursive: true, force: true })
}
