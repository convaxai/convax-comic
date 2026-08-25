import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    name: '@convax/desktop',
    entry: {
      main: 'src/main.ts',
      plugin: 'src/plugin.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    clean: true,
    sourcemap: true,
    dts: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    name: '@convax/desktop/bin',
    entry: {
      bin: 'src/bin.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: false,
    deps: { neverBundle: ['electron'] },
    outputOptions: {
      banner: '#!/usr/bin/env node',
    },
  },
  {
    name: '@convax/desktop/preload',
    entry: {
      preload: 'src/preload.ts',
      'parent-guard': 'src/parent-guard.ts',
    },
    outDir: 'lib',
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    clean: false,
    sourcemap: true,
    dts: false,
    deps: { neverBundle: ['electron'] },
    outputOptions: {
      entryFileNames: '[name].cjs',
    },
  },
])
