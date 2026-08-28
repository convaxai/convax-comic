import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@convax/canvas'
const INLINE_CSS_QUERY = '?inline'
const INLINE_CSS_PREFIX = '\0convax-canvas-css:'
const moduleRequire = createRequire(import.meta.url)
const inlineCssFiles = new Map<string, string>()

function isClientExternal(specifier: string): boolean {
  return specifier === 'react'
    || specifier.startsWith('react/')
    || specifier === 'react-dom'
    || specifier.startsWith('react-dom/')
    || specifier === '@deepseek-ai/cordis'
    || specifier === '@deepseek-ai/dsh-client-runtime/client'
}

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    sourcemap: true,
    deps: {
      neverBundle: [
        '@convax/canvas-api',
        '@convax/canvas-builtins',
        '@convax/canvas-store-api',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-typert-protocol',
        'zod',
      ],
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: true,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: isClientExternal,
      alwaysBundle: (specifier: string) => !isClientExternal(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      name: 'convax-canvas-css-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith(INLINE_CSS_QUERY)) return null
        const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
        const file = stylesheet.startsWith('.') && importer !== undefined
          ? resolve(dirname(importer), stylesheet)
          : moduleRequire.resolve(stylesheet)
        // Keep absolute build paths out of the shipped bundle and keep the
        // virtual id from looking like CSS to tsdown's stylesheet guard.
        const id = INLINE_CSS_PREFIX + createHash('sha256').update(file).digest('hex').slice(0, 16)
        inlineCssFiles.set(id, file)
        return id
      },
      async load(id: string) {
        if (!id.startsWith(INLINE_CSS_PREFIX)) return null
        const file = inlineCssFiles.get(id)
        if (file === undefined) throw new Error(`missing inlined stylesheet for ${id}`)
        this.addWatchFile(file)
        return `export default ${JSON.stringify(await readFile(file, 'utf8'))};`
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
