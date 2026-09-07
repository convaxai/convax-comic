import { describe, expect, it } from 'vitest'
import {
  filterAllowedAgentPresets,
  isAllowedAgentPreset,
} from '../src/index.ts'

describe('Convax agent preset policy', () => {
  it('keeps only presets that use the Host sandbox and approval seams', () => {
    const presets = ['standard', 'minimal', 'ptc', 'cordis'].map(id => ({
      id,
      trust: 'system' as const,
      path: `/presets/${id}/agent.cordis.yml`,
    }))
    expect(filterAllowedAgentPresets(presets).map(preset => preset.id))
      .toEqual(['standard', 'ptc'])
    expect(isAllowedAgentPreset('minimal')).toBe(false)
    expect(isAllowedAgentPreset('cordis')).toBe(false)
  })
})
