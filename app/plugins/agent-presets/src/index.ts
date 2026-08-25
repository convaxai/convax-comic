import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import AgentPresets, {
  type AgentPreset,
  type Config,
} from '@deepseek-ai/dsh-agent-presets'

export const ALLOWED_AGENT_PRESETS = Object.freeze(['standard', 'code'] as const)
const allowed = new Set<string>(ALLOWED_AGENT_PRESETS)
const require = createRequire(import.meta.url)

export function isAllowedAgentPreset(id: string): boolean {
  return allowed.has(id)
}

export function filterAllowedAgentPresets(
  presets: readonly AgentPreset[],
): AgentPreset[] {
  return presets.filter((preset) => isAllowedAgentPreset(preset.id))
}

function shippedPresetRoot(): string {
  return join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')
}

/** Product roster that excludes presets which bypass the Host permission seam. */
export default class ConvaxAgentPresets extends AgentPresets {
  constructor(ctx: Context, config: Config) {
    super(ctx, {
      default: isAllowedAgentPreset(config.default) ? config.default : 'standard',
      roots: [{ path: shippedPresetRoot(), trust: 'system' }],
      includeUserRoot: false,
    })
  }

  override get defaultId(): string {
    const selected = super.defaultId
    return isAllowedAgentPreset(selected) ? selected : 'standard'
  }

  override async list(): Promise<AgentPreset[]> {
    return filterAllowedAgentPresets(await super.list())
  }
}
