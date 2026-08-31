import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const PACKAGE = '@convax/project'
const INLINE_QUERY = '?inline'
const INLINE_PREFIX = '\0convax-project-css:'
const cssFiles = new Map<string, string>()

function clientExternal(specifier: string): boolean {
  return specifier === 'react'
    || specifier.startsWith('react/')
    || specifier === 'react-dom'
    || specifier.startsWith('react-dom/')
    || specifier === '@deepseek-ai/cordis'
    || specifier === '@deepseek-ai/dsh-client-runtime/client'
}

export default defineConfig([
  {
    name: PACKAGE,
    entry: { index: 'src/index.ts', contracts: 'src/contracts.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    clean: true,
    sourcemap: true,
    dts: true,
    deps: {
      neverBundle: [
        'chokidar',
        'zod',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-fs',
        '@deepseek-ai/dsh-typert-protocol',
        '@deepseek-ai/dsh-workspace',
      ],
    },
  },
  {
    name: `${PACKAGE}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: true,
    deps: { neverBundle: clientExternal, alwaysBundle: (specifier: string) => !clientExternal(specifier) },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'convax-project-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(INLINE_QUERY) || importer === undefined) return null
        const file = resolve(dirname(importer), source.slice(0, -INLINE_QUERY.length))
        const id = INLINE_PREFIX + createHash('sha256').update(file).digest('hex').slice(0, 16)
        cssFiles.set(id, file)
        return id
      },
      async load(id: string) {
        if (!id.startsWith(INLINE_PREFIX)) return null
        const file = cssFiles.get(id)
        if (file === undefined) throw new Error(`missing stylesheet for ${id}`)
        this.addWatchFile(file)
        return `export default ${JSON.stringify(await readFile(file, 'utf8'))};`
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
