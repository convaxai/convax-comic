import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const config = await readFile(new URL('../tsdown.config.ts', import.meta.url), 'utf8')

describe('UI browser bundle contract', () => {
  it('replaces Node environment guards before the ModuleLoader executes', () => {
    expect(config).toContain("'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production')")
    expect(config).toContain("'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production')")
    expect(config).toContain("'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' })")
  })
})
