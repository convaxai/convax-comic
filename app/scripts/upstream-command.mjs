import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { REPOSITORY_ROOT } from './profile-runtime.mjs'

const action = process.argv[2]
const argumentsByAction = {
  version: ['--version'],
  install: ['install', '--frozen-lockfile'],
  build: ['run', 'build'],
}
const args = argumentsByAction[action]
if (args === undefined) {
  process.stderr.write('usage: node app/scripts/upstream-command.mjs <version|install|build>\n')
  process.exit(2)
}

const result = spawnSync('corepack', ['pnpm', ...args], {
  cwd: join(REPOSITORY_ROOT, 'deepseek-harness'),
  env: {
    ...process.env,
    // The upstream postinstall deliberately skips worktree-local hook writes
    // in CI; product validation must remain read-only for the submodule.
    CI: 'true',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
