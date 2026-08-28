import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'neutral',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  sourcemap: true,
  deps: { neverBundle: ['@deepseek-ai/cordis', 'react'] },
})
