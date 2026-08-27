import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { REPOSITORY_ROOT } from './profile-runtime.mjs'

const workflowPath = join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml')
const workflow = YAML.parse(readFileSync(workflowPath, 'utf8'))

function fail(message) {
  throw new Error(`CI gate: ${message}`)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

const triggers = workflow.on
assert(triggers?.pull_request === null, 'pull_request trigger is missing')
assert(triggers?.workflow_dispatch === null, 'workflow_dispatch trigger is missing')
assert(JSON.stringify(triggers?.push?.branches) === JSON.stringify(['main']), 'push trigger is not limited to main')
assert(JSON.stringify(workflow.permissions) === JSON.stringify({ contents: 'read' }), 'workflow permissions exceed contents: read')
assert(workflow.env?.PRIMARY_NODE_VERSION === '24.9.0', 'primary Node is not pinned to packaged Node 24.9.0')
assert(workflow.env?.COREPACK_VERSION === '0.34.1', 'Corepack is not pinned across supported Node versions')
assert(workflow.env?.DSH_TELEMETRY_DISABLED === '1', 'CI may report to production telemetry')
assert(workflow.concurrency?.['cancel-in-progress'] === true, 'superseded CI runs are not cancelled')

const jobs = workflow.jobs ?? {}
const requiredJobs = ['static', 'unit', 'node-compat', 'runtime-macos', 'package-macos', 'all-checks-passed']
assert(JSON.stringify(Object.keys(jobs)) === JSON.stringify(requiredJobs), 'workflow job inventory changed')

const ACTION_PINS = new Set([
  'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
])
for (const [jobName, job] of Object.entries(jobs)) {
  for (const step of job.steps ?? []) {
    if (step.uses === undefined) continue
    assert(/@[a-f0-9]{40}$/u.test(step.uses), `${jobName} uses an action without a full commit pin`)
    assert(ACTION_PINS.has(step.uses), `${jobName} uses an unreviewed action ${step.uses}`)
  }
}

for (const jobName of ['static', 'unit', 'node-compat', 'runtime-macos', 'package-macos']) {
  const job = jobs[jobName]
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert(checkout?.with?.['persist-credentials'] === false, `${jobName} persists checkout credentials`)
  assert(
    job.steps.some(step => step.run === 'npm install --global corepack@${COREPACK_VERSION}'),
    `${jobName} does not provision the pinned package-manager shim`,
  )
  assert(job.steps.some(step => step.run === 'corepack yarn install --immutable'), `${jobName} does not install immutably`)
}

assert(jobs.static?.['runs-on'] === 'ubuntu-24.04', 'primary static job is not on pinned Ubuntu 24.04')
const staticGate = jobs.static?.steps?.find(step => step.name === 'Run static and repository-contract gates')?.run ?? ''
for (const command of [
  'corepack yarn check:ci-config',
  'corepack yarn check:layout',
  'corepack yarn build',
  'corepack yarn typecheck',
  'corepack yarn check:profiles',
]) {
  assert(staticGate.split('\n').includes(command), `primary static job omits ${command}`)
}
assert(!staticGate.includes('check:dump-config'), 'Ubuntu static job invokes the macOS-only dump-config gate')
assert(
  jobs.unit?.steps?.some(step => step.run === 'corepack yarn build')
    && jobs.unit?.steps?.some(step => step.run === 'corepack yarn test'),
  'primary unit job does not build a clean checkout before testing',
)
assert(
  JSON.stringify(jobs['node-compat']?.strategy?.matrix?.node) === JSON.stringify(['22.19.0', '26']),
  'Node compatibility matrix changed',
)
assert(
  jobs['node-compat']?.steps?.some(step => step.run === 'corepack yarn check:node-compat'),
  'Node compatibility job does not run its gate',
)
assert(jobs['runtime-macos']?.['runs-on'] === 'macos-15', 'DSH integration is not on macOS 15 arm64')
assert(
  jobs['runtime-macos']?.steps?.some(step => step.run?.includes('uname -m') && step.run.includes('arm64')),
  'DSH integration does not assert runner architecture',
)
for (const command of ['corepack yarn build', 'corepack yarn check:dump-config', 'corepack yarn smoke:upstream']) {
  assert(
    jobs['runtime-macos']?.steps?.some(step => step.run === command),
    `DSH integration omits ${command}`,
  )
}
assert(jobs['package-macos']?.['runs-on'] === 'macos-15', 'packaged smoke is not on macOS 15 arm64')
assert(
  jobs['package-macos']?.steps?.some(step => step.run?.includes('uname -m') && step.run.includes('arm64')),
  'packaged smoke does not assert runner architecture',
)
assert(
  jobs['package-macos']?.steps?.some(step => step.run === 'corepack yarn package:dir'),
  'packaged smoke does not exercise the final directory',
)
const verdict = jobs['all-checks-passed']
assert(
  JSON.stringify(verdict?.needs) === JSON.stringify(['static', 'unit', 'node-compat', 'runtime-macos', 'package-macos']),
  'stable verdict does not aggregate every required job',
)
assert(String(verdict?.if).includes('always()'), 'stable verdict may be skipped after a dependency failure')
const failureGuard = verdict?.steps?.find(step => step.name === 'Fail if any required job did not succeed')
for (const result of ['failure', 'cancelled', 'skipped']) {
  assert(String(failureGuard?.if).includes(result), `stable verdict ignores ${result} dependencies`)
}

process.stdout.write('CI gate: workflow triggers, action pins, static/unit/compatibility lanes, runtime integration, package smoke, and stable verdict pass\n')
