import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const bundles = [
  'app/plugins/canvas/lib/client.js',
  'app/plugins/canvas-builtins/lib/client.js',
  'app/plugins/project/lib/client.js',
  'app/plugins/ui/lib/client.js',
]
const moduleLoaderSeeds = new Set([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  'react',
  'react/jsx-runtime',
  'react-dom',
])
// Motion probes this optional package inside try/catch. ModuleLoader rejection is
// intentionally swallowed and Motion falls back to its built-in prop filter.
const caughtOptionalRequires = new Set(['@emotion/is-prop-valid'])
const requirePattern = /\brequire\((['"])([^'"]+)\1\)/gu

const failures = []
for (const path of bundles) {
  const source = await readFile(join(repositoryRoot, path), 'utf8')
  const required = new Set([...source.matchAll(requirePattern)].map(match => match[2]))
  const unsupported = [...required]
    .filter(specifier => !moduleLoaderSeeds.has(specifier) && !caughtOptionalRequires.has(specifier))
    .sort()
  if (unsupported.length !== 0) failures.push(`${path}: ${unsupported.join(', ')}`)
}

if (failures.length !== 0) {
  throw new Error(`client bundle contains require() calls outside the DSH module table:\n${failures.join('\n')}`)
}

process.stdout.write('client bundle gate: every direct require is a platform seed or an explicitly caught optional probe\n')
