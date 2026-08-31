import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import YAML from 'yaml'

const rawResourcesRoot = process.argv[2]
if (typeof rawResourcesRoot !== 'string' || rawResourcesRoot.length === 0) {
  throw new Error('usage: node packaged-smoke.mjs <Resources>')
}
const resourcesRoot = resolve(rawResourcesRoot)

const packagedAppRoot = join(resourcesRoot, 'app')
const packagedNode = join(packagedAppRoot, 'node_modules', 'node-bin-darwin-arm64', 'bin', 'node')
const packagedDsh = join(packagedAppRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const parentGuard = join(packagedAppRoot, 'lib', 'parent-guard.cjs')
const trustedSecurityPatch = join(resourcesRoot, 'profiles', 'security.patch.yml')
const root = mkdtempSync(join(tmpdir(), 'convax-packaged-smoke-'))
const harnessHome = join(root, 'harness')
const launchRoot = join(root, 'launch-root')
const emptyPath = join(root, 'empty-path')
const isolatedHome = join(root, 'home')
const productData = join(root, 'product-data')
const token = randomBytes(32).toString('base64url')
let child
let tail = ''
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

function profilePackageNames(profile) {
  const patch = YAML.parse(readFileSync(join(resourcesRoot, 'profiles', profile, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error(`packaged ${profile} patch root is not an array`)
  const names = patch.flatMap(row => Array.isArray(row?.insert) ? row.insert : [])
    .map(row => row?.name)
  if (names.some(name => typeof name !== 'string' || !PACKAGE_NAME.test(name))) {
    throw new Error(`packaged ${profile} patch contains an invalid package name`)
  }
  return [...new Set(names)]
}

function assertPackagedDirectory(path) {
  if (lstatSync(path).isSymbolicLink()) throw new Error(`packaged dependency is a symlink: ${path}`)
  const resolved = realpathSync(path)
  if (relative(resourcesRoot, resolved).startsWith('..')) {
    throw new Error(`packaged dependency escapes Resources: ${path}`)
  }
}

function materializeProfile(profile) {
  const source = join(resourcesRoot, 'profiles', profile)
  const target = join(harnessHome, 'profiles', profile)
  mkdirSync(target, { recursive: true, mode: 0o700 })
  copyFileSync(join(source, 'package.json'), join(target, 'package.json'))
  copyFileSync(join(source, 'cordis.patch.yml'), join(target, 'cordis.patch.yml'))

  const modules = join(harnessHome, 'profiles', 'node_modules')
  for (const packageName of profilePackageNames(profile)) {
    const packaged = packageName === '@convax/desktop'
      ? packagedAppRoot
      : join(packagedAppRoot, 'node_modules', ...packageName.split('/'))
    assertPackagedDirectory(packaged)
    const link = join(modules, ...packageName.split('/'))
    mkdirSync(dirname(link), { recursive: true, mode: 0o700 })
    symlinkSync(packaged, link, 'junction')
  }
}

function waitForExit(timeoutMs = 10_000) {
  if (child?.exitCode !== null || child?.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('packaged DSH did not exit in time')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function waitForReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`packaged readiness timed out\n${tail}`)), 60_000)
    child.on('message', message => {
      if (message?.type === 'convax:startup-failed') {
        clearTimeout(timeout)
        reject(new Error(`packaged composition failed: ${String(message.message)}\n${tail}`))
        return
      }
      if (message?.type !== 'convax:ready') return
      clearTimeout(timeout)
      resolve(message)
    })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`packaged DSH exited before readiness (${code ?? signal})\n${tail}`))
    })
  })
}

try {
  for (const path of [packagedAppRoot, packagedNode, packagedDsh]) assertPackagedDirectory(dirname(path))
  for (const path of [launchRoot, emptyPath, isolatedHome, productData]) mkdirSync(path, { recursive: true })
  writeFileSync(join(productData, 'sentinel'), 'product-owned\n')
  materializeProfile('default')
  const nodePty = join(packagedAppRoot, 'node_modules', 'node-pty', 'lib', 'index.js')
  const ptyProbe = spawnSync(packagedNode, ['--eval', `
const pty = require(${JSON.stringify(nodePty)})
const terminal = pty.spawn('/bin/sh', ['-lc', 'printf convax-pty-ok'], {
  cols: 80,
  rows: 24,
  cwd: ${JSON.stringify(launchRoot)},
  env: { PATH: '/usr/bin:/bin' },
})
let output = ''
const timeout = setTimeout(() => { terminal.kill(); process.exit(2) }, 5000)
terminal.onData(chunk => { output += chunk })
terminal.onExit(event => {
  clearTimeout(timeout)
  process.exit(event.exitCode === 0 && output.includes('convax-pty-ok') ? 0 : 3)
})
`], {
    cwd: launchRoot,
    env: { HOME: isolatedHome, PATH: emptyPath, TMPDIR: tmpdir() },
    encoding: 'utf8',
  })
  if (ptyProbe.error !== undefined) throw ptyProbe.error
  if (ptyProbe.status !== 0) {
    throw new Error(`packaged node-pty probe failed (${String(ptyProbe.status)}): ${ptyProbe.stderr}`)
  }
  writeFileSync(join(harnessHome, 'cordis.patch.yml'), [
    '- id: webserver',
    '  disabled: false',
    '  config:',
    '    host: 0.0.0.0',
    '    port: 0',
    '- id: app-auth-fence',
    '  disabled: true',
    '- id: agent-presets',
    '  disabled: false',
    '- id: app-agent-presets',
    '  disabled: true',
    '- id: sandbox-policy',
    '  config:',
    '    mode: danger-full-access',
    '',
  ].join('\n'))

  child = spawn(packagedNode, [
    '--require',
    parentGuard,
    packagedDsh,
    '--profile',
    'default',
    '--patch',
    trustedSecurityPatch,
    '--host',
    '127.0.0.1',
    '--port',
    '0',
    '--no-open',
  ], {
    cwd: launchRoot,
    env: {
      CONVAX_CONTROL_TOKEN: token,
      CONVAX_PROFILE: 'default',
      CONVAX_PROJECTS_HOME: productData,
      DSH_HOME: harnessHome,
      DSH_TELEMETRY_DISABLED: '1',
      HOME: isolatedHome,
      PATH: emptyPath,
      TMPDIR: tmpdir(),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const capture = chunk => {
    tail = `${tail}${String(chunk).replaceAll(token, '[REDACTED]')}`.slice(-16_000)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)

  const ready = await waitForReady()
  const origin = new URL(ready.origin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/') {
    throw new Error(`packaged DSH reported unsafe origin ${JSON.stringify(ready.origin)}`)
  }
  const denied = await fetch(origin.origin)
  if (denied.status !== 403) throw new Error(`packaged auth fence returned ${denied.status} without token`)
  const allowed = await fetch(origin.origin, {
    headers: { 'x-convax-control-token': token },
  })
  if (allowed.status !== 200) throw new Error(`packaged UI returned ${allowed.status} with token`)
  const presets = await fetch(`${origin.origin}/api/agentPreset.list`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-convax-control-token': token,
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'convax-packaged-preset-smoke',
      method: 'agentPreset.list',
      payload: {},
    }),
  })
  const presetEnvelope = await presets.json()
  const presetIds = presetEnvelope?.result?.value?.presets?.map?.(preset => preset.id)
  if (presets.status !== 200
    || JSON.stringify(presetIds) !== JSON.stringify(['standard', 'code'])
    || presetEnvelope?.result?.value?.authorable !== false) {
    throw new Error(`packaged Agent preset policy failed: ${JSON.stringify(presetEnvelope)}`)
  }

  const canvasSuffix = `${process.pid}:${Date.now()}`
  const canvasWorkspaceId = `workspace:smoke:${canvasSuffix}`
  const createCanvasRpcId = `convax-packaged-canvas-v2-create-smoke-${canvasSuffix}`
  const createdCanvas = await fetch(`${origin.origin}/api/canvasV2/createProject`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-convax-control-token': token,
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: createCanvasRpcId,
      method: 'canvasV2/createProject',
      payload: {
        args: {
          request: {
            workspaceId: canvasWorkspaceId,
            projectId: 'project:root',
            canvasId: 'canvas:main',
            title: 'Packaged smoke canvas',
            mutationId: createCanvasRpcId,
            source: 'packaged-smoke',
          },
        },
      },
    }),
  })
  const createdCanvasEnvelope = await createdCanvas.json()
  if (createdCanvas.status !== 200 || createdCanvasEnvelope?.result?.ok !== true) {
    throw new Error(`packaged Canvas V2 project creation failed: ${JSON.stringify(createdCanvasEnvelope)}`)
  }

  const canvasRpcId = 'convax-packaged-canvas-v2-get-smoke'
  const canvas = await fetch(`${origin.origin}/api/canvasV2/getProject`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-convax-control-token': token,
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: canvasRpcId,
      method: 'canvasV2/getProject',
      payload: {
        args: {
          request: {
            workspaceId: canvasWorkspaceId,
            projectId: 'project:root',
          },
        },
      },
    }),
  })
  const canvasEnvelope = await canvas.json()
  const canvasProject = canvasEnvelope?.result?.value
  if (canvas.status !== 200
    || canvasEnvelope?.rpcId !== canvasRpcId
    || canvasEnvelope?.result?.ok !== true
    || canvasProject?.schemaVersion !== 2
    || canvasProject?.workspaceId !== canvasWorkspaceId
    || canvasProject?.id !== 'project:root'
    || canvasProject?.activeCanvasId !== 'canvas:main') {
    throw new Error(`packaged Canvas V2 Remote failed: ${JSON.stringify(canvasEnvelope)}`)
  }

  child.kill('SIGTERM')
  await waitForExit()
  if (readFileSync(join(productData, 'sentinel'), 'utf8') !== 'product-owned\n') {
    throw new Error('packaged runtime changed product-owned data')
  }
  const canvasDatabase = join(productData, 'default', '.stores', 'sqlite', 'canvas', 'canvas.sqlite3')
  if ((statSync(canvasDatabase).mode & 0o777) !== 0o600) {
    throw new Error('packaged Canvas database permissions are not 0600')
  }
  process.stdout.write('packaged smoke: isolated Node/DSH closure, PTY, safe Agent presets, auth fence, Canvas V2 Remote, SQLite authority, and data boundary pass\n')
} finally {
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await waitForExit().catch(() => undefined)
  }
  rmSync(root, { recursive: true, force: true })
}
