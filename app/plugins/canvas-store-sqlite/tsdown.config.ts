import { defineConfig } from 'tsdown'

export default defineConfig({
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
      '@convax/canvas-store-api',
      '@convax/sqlite-runtime',
      '@deepseek-ai/cordis',
    ],
  },
})
