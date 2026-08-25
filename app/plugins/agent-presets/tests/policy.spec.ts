import { describe, expect, it } from 'vitest'
import {
  filterAllowedAgentPresets,
  isAllowedAgentPreset,
} from '../src/index.ts'

describe('Convax agent preset policy', () => {
  it('keeps only presets that use the Host sandbox and approval seams', () => {
    const presets = ['standard', 'minimal', 'code', 'cordis'].map(id => ({
      id,
      trust: 'system' as const,
      path: `/presets/${id}/agent.cordis.yml`,
    }))
    expect(filterAllowedAgentPresets(presets).map(preset => preset.id))
      .toEqual(['standard', 'code'])
    expect(isAllowedAgentPreset('minimal')).toBe(false)
    expect(isAllowedAgentPreset('cordis')).toBe(false)
  })
})
