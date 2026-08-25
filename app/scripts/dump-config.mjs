import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  dshBinPath,
  packagedNodeBinPath,
  PROFILE_NAMES,
  provisionProfile,
  TRUSTED_SECURITY_PATCH,
} from './profile-runtime.mjs'

const profile = process.argv[2] ?? 'default'
if (!PROFILE_NAMES.includes(profile)) {
  process.stderr.write(`usage: node app/scripts/dump-config.mjs <${PROFILE_NAMES.join('|')}>\n`)
  process.exit(2)
}

const home = mkdtempSync(join(tmpdir(), `convax-dump-${profile}-`))
try {
  provisionProfile(home, profile)
  const result = spawnSync(packagedNodeBinPath(), [
    dshBinPath(),
    '--profile',
    profile,
    '--patch',
    TRUSTED_SECURITY_PATCH,
    '--dump-config',
  ], {
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
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  process.stdout.write(result.stdout.replaceAll(home, '$DSH_HOME'))
} finally {
  if (process.env.CONVAX_KEEP_DUMP_HOME !== '1') rmSync(home, { recursive: true, force: true })
}
