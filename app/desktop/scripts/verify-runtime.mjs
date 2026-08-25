import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error(`Convax M1 packages Node only for darwin-arm64; received ${process.platform}-${process.arch}`)
}
const manifestPath = require.resolve('node-bin-darwin-arm64/package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.node
if (typeof relativeBin !== 'string') throw new Error('node-bin-darwin-arm64@24.9.0 has no node binary')
const binary = join(dirname(manifestPath), relativeBin)
const version = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()
if (version !== 'v24.9.0') throw new Error(`expected v24.9.0, received ${version}`)
process.stdout.write('independent Node v24.9.0 verified\n')
