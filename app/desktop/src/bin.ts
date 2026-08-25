import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronBinary = require('electron') as unknown
if (typeof electronBinary !== 'string') throw new Error('electron package did not expose its executable')

const main = fileURLToPath(new URL('./main.js', import.meta.url))
const { ELECTRON_RUN_AS_NODE: _forbidden, ...safeEnvironment } = process.env
const result = spawnSync(electronBinary, [main, ...process.argv.slice(2)], {
  env: safeEnvironment,
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
