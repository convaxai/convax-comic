import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const config = await readFile(new URL('../tsdown.config.ts', import.meta.url), 'utf8')

describe('Canvas browser bundle contract', () => {
  it('bundles workspace client contracts from source on a clean checkout', () => {
    expect(config).toContain("['@convax/canvas-api', resolve(packageRoot, '../canvas-api/src/index.ts')]")
    expect(config).toContain("['@convax/project/contracts', resolve(packageRoot, '../project/src/contracts.ts')]")
    expect(config).toContain("name: 'convax-canvas-workspace-source'")
    expect(config).toContain('return clientWorkspaceSources.get(source) ?? null')
  })
})
