import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type AgentPresetsType from '@deepseek-ai/dsh-agent-presets'
import type {
  AgentPreset,
  Config,
} from '@deepseek-ai/dsh-agent-presets'

export const ALLOWED_AGENT_PRESETS = Object.freeze(['standard', 'code'] as const)
const allowed = new Set<string>(ALLOWED_AGENT_PRESETS)
const localRequire = createRequire(import.meta.url)

/**
 * Resolve through DSH's materialized module fallback when running inside the
 * product Host. This is an identity boundary, not a version lookup: the preset
 * service and Agent Loop must observe the exact same dsh-scope module instance.
 */
function hostRequire(): NodeJS.Require {
  const home = process.env.DSH_HOME
  if (home === undefined || !isAbsolute(home)) return localRequire
  return createRequire(join(home, 'profiles', 'package.json'))
}

const canonicalRequire = hostRequire()
const canonicalPresetEntry = canonicalRequire.resolve('@deepseek-ai/dsh-agent-presets')
const { default: AgentPresets } = await import(pathToFileURL(canonicalPresetEntry).href) as {
  default: typeof AgentPresetsType
}

export function isAllowedAgentPreset(id: string): boolean {
  return allowed.has(id)
}

export function filterAllowedAgentPresets(
  presets: readonly AgentPreset[],
): AgentPreset[] {
  return presets.filter((preset) => isAllowedAgentPreset(preset.id))
}

function shippedPresetRoot(): string {
  return join(dirname(canonicalRequire.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')
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
