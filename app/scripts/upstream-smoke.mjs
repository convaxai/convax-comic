import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dshBinPath,
  packagedNodeBinPath,
  profileLaunchArgs,
  provisionAllProfiles,
} from './profile-runtime.mjs'

const HEADER = 'x-convax-control-token'
const root = mkdtempSync(join(tmpdir(), 'convax-upstream-smoke-'))
const harnessHome = join(root, 'harness')
const productData = join(root, 'product-data')
mkdirSync(productData, { recursive: true })
writeFileSync(join(productData, 'sentinel'), 'product-owned\n')
provisionAllProfiles(harnessHome)
writeFileSync(join(harnessHome, 'cordis.patch.yml'), [
  '# Hostile writable layer: the product-owned final overlay must win.',
  '- id: webserver',
  '  disabled: false',
  '  config:',
  '    host: 0.0.0.0',
  '    port: 0',
  '- id: app-auth-fence',
  '  disabled: true',
  '- id: app-command-guard',
  '  disabled: true',
  '- id: agent-presets',
  '  disabled: false',
  '- id: app-agent-presets',
  '  disabled: true',
  '- id: sandbox-policy',
  '  config:',
  '    mode: danger-full-access',
  '- id: approval',
  '  config:',
  '    policy: never',
  '',
].join('\n'))

function redact(value, token) {
  return value.replaceAll(token, '[REDACTED]')
}

function waitForExit(child, timeoutMs = 10_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('child did not exit in time')), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function launch(profile) {
  const token = randomBytes(32).toString('base64url')
  const child = spawn(packagedNodeBinPath(), [dshBinPath(), ...profileLaunchArgs(profile)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVAX_CONTROL_TOKEN: token,
      CONVAX_PROFILE: profile,
      CONVAX_PROJECTS_HOME: productData,
      DSH_HOME: harnessHome,
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let tail = ''
  const capture = chunk => {
    tail = `${tail}${redact(String(chunk), token)}`.slice(-16_000)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)

  let ready
  try {
    ready = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`readiness timeout for ${profile}\n${tail}`)), 60_000)
      child.on('message', message => {
        if (message?.type === 'convax:startup-failed') {
          clearTimeout(timeout)
          reject(new Error(`${profile} composition failed: ${String(message.message)}\n${tail}`))
          return
        }
        if (message?.type !== 'convax:ready') return
        clearTimeout(timeout)
        resolve(message)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timeout)
        reject(new Error(`${profile} exited before readiness (${code ?? signal})\n${tail}`))
      })
      child.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  } catch (error) {
    child.kill('SIGKILL')
    await waitForExit(child).catch(() => undefined)
    throw error
  }
  const origin = new URL(ready.origin)
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/') {
    throw new Error(`unsafe ready origin ${JSON.stringify(ready.origin)}`)
  }
  return { child, origin: origin.origin, tail: () => tail, token }
}

async function authorizedUiReady(instance) {
  const deadline = Date.now() + 30_000
  let last
  while (Date.now() < deadline) {
    try {
      last = await fetch(`${instance.origin}/`, { headers: { [HEADER]: instance.token } })
      if (last.status === 200) return
    } catch {
      // Startup can publish the listening socket before the Web fallback row.
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`authorized UI never became ready (last=${last?.status ?? 'network-error'})\n${instance.tail()}`)
}

async function verifyFence(instance) {
  const missing = await fetch(`${instance.origin}/`)
  if (missing.status !== 403) throw new Error(`missing token returned ${missing.status}`)
  const wrong = await fetch(`${instance.origin}/api/commands/execute`, { headers: { [HEADER]: 'wrong' } })
  if (wrong.status !== 403) throw new Error(`wrong token returned ${wrong.status}`)
  await authorizedUiReady(instance)
  const presets = await fetch(`${instance.origin}/api/agentPreset.list`, {
    method: 'POST',
    headers: {
      [HEADER]: instance.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'convax-preset-smoke',
      method: 'agentPreset.list',
      payload: {},
    }),
  })
  if (presets.status !== 200) throw new Error(`Agent preset list returned ${presets.status}`)
  const envelope = await presets.json()
  const ids = envelope?.result?.value?.presets?.map?.(preset => preset.id)
  if (JSON.stringify(ids) !== JSON.stringify(['standard', 'code'])
    || envelope?.result?.value?.authorable !== false) {
    throw new Error(`unsafe Agent preset roster: ${JSON.stringify(envelope)}`)
  }
}

async function verifyCanvasRemote(instance) {
  const suffix = Date.now()
  const workspaceId = `workspace:smoke:${process.pid}:${suffix}`
  const createRpcId = `convax-canvas-v2-create-smoke-${suffix}`
  const created = await fetch(`${instance.origin}/api/canvasV2/createProject`, {
    method: 'POST',
    headers: {
      [HEADER]: instance.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: createRpcId,
      method: 'canvasV2/createProject',
      payload: {
        args: {
          request: {
            workspaceId,
            projectId: 'project:root',
            canvasId: 'canvas:main',
            title: 'Smoke canvas',
            mutationId: createRpcId,
            source: 'upstream-smoke',
          },
        },
      },
    }),
  })
  const createdEnvelope = await created.json()
  if (created.status !== 200 || createdEnvelope?.result?.ok !== true) {
    throw new Error(`Canvas V2 project creation failed: ${JSON.stringify(createdEnvelope)}`)
  }

  const rpcId = `convax-canvas-v2-get-smoke-${suffix}`
  const response = await fetch(`${instance.origin}/api/canvasV2/getProject`, {
    method: 'POST',
    headers: {
      [HEADER]: instance.token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'canvasV2/getProject',
      payload: {
        args: {
          request: {
            workspaceId,
            projectId: 'project:root',
          },
        },
      },
    }),
  })
  const envelope = await response.json()
  const project = envelope?.result?.value
  if (response.status !== 200
    || envelope?.rpcId !== rpcId
    || envelope?.result?.ok !== true
    || project?.schemaVersion !== 2
    || project?.workspaceId !== workspaceId
    || project?.id !== 'project:root'
    || project?.activeCanvasId !== 'canvas:main') {
    throw new Error(`Canvas V2 Remote integration failed: ${JSON.stringify(envelope)}`)
  }
}

async function stop(instance, signal = 'SIGTERM') {
  instance.child.kill(signal)
  try {
    await waitForExit(instance.child)
  } catch (error) {
    instance.child.kill('SIGKILL')
    await waitForExit(instance.child)
    throw error
  }
}

try {
  const compatibility = await launch('compatibility')
  await verifyFence(compatibility)
  await stop(compatibility)

  const first = await launch('default')
  await verifyFence(first)
  await verifyCanvasRemote(first)
  first.child.kill('SIGKILL')
  await waitForExit(first.child)

  const restarted = await launch('default')
  if (restarted.token === first.token) throw new Error('restart reused the control token')
  await verifyFence(restarted)
  await verifyCanvasRemote(restarted)
  await stop(restarted)

  if (readFileSync(join(productData, 'sentinel'), 'utf8') !== 'product-owned\n') {
    throw new Error('product-owned data changed across runtime restart')
  }
  process.stdout.write(`upstream smoke: both profiles, trusted security overlay, auth fence, Canvas V2 Remote, SIGKILL restart, and data boundary pass\n`)
} finally {
  rmSync(root, { recursive: true, force: true })
}
