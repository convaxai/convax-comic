import { defineConfig } from 'tsdown'

export default defineConfig({
  name: '@convax/beui',
  entry: { index: 'src/index.ts', styles: 'src/styles.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  clean: true,
  sourcemap: true,
  dts: true,
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'motion',
      'motion/react',
      'lucide-react',
    ],
  },
})
