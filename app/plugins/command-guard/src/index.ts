import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export interface CommandHazard {
  readonly code: string
  readonly reason: string
  readonly segment: string
}

export const name = 'app-command-guard'
export const inject = ['tools']

const WRAPPERS = new Set(['command', 'nohup', 'sudo'])
const SHELLS = new Set(['bash', 'cmd', 'dash', 'fish', 'ksh', 'pwsh', 'powershell', 'sh', 'zsh'])

function executableName(token: string): string {
  const normalized = token.replace(/^[({]+/u, '').replace(/[)}]+$/u, '').replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase().replace(/\.exe$/u, '')
}

/** Split shell control operators only when they are outside quotes/escapes. */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = []
  let quote: "'" | '"' | null = null
  let escaped = false
  let start = 0
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    const next = command[index + 1]
    const width = (char === '&' && next === '&') || (char === '|' && next === '|') ? 2 : 1
    if (char !== ';' && char !== '\n' && char !== '|' && char !== '&') continue
    const segment = command.slice(start, index).trim()
    if (segment !== '') segments.push(segment)
    index += width - 1
    start = index + 1
  }
  const tail = command.slice(start).trim()
  if (tail !== '') segments.push(tail)
  return segments
}

/** Minimal quote-aware tokenization; it deliberately does not evaluate shell. */
export function tokenizeCommand(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  const push = () => {
    if (current !== '') tokens.push(current)
    current = ''
  }
  for (const char of segment) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (/\s/u.test(char)) push()
    else current += char
  }
  if (escaped) current += '\\'
  push()
  return tokens
}

function unwrap(tokens: readonly string[]): readonly string[] {
  let remaining = [...tokens]
  while (remaining.length > 0) {
    while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(remaining[0] ?? '')) remaining = remaining.slice(1)
    const executable = executableName(remaining[0] ?? '')
    if (executable === 'env') {
      remaining = remaining.slice(1)
      while ((remaining[0] ?? '').startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(remaining[0] ?? '')) {
        remaining = remaining.slice(1)
      }
      continue
    }
    if (!WRAPPERS.has(executable)) break
    remaining = remaining.slice(1)
    if (executable === 'sudo') {
      while ((remaining[0] ?? '').startsWith('-')) remaining = remaining.slice(1)
    }
  }
  return remaining
}

function hasShortFlag(args: readonly string[], flag: string): boolean {
  return args.some(arg => /^-[^-]/u.test(arg) && arg.slice(1).toLowerCase().includes(flag.toLowerCase()))
}

function hazard(code: string, reason: string, segment: string): CommandHazard {
  return { code, reason, segment }
}

function inspectTokens(rawTokens: readonly string[], segment: string, depth: number): CommandHazard | undefined {
  const tokens = unwrap(rawTokens)
  const executable = executableName(tokens[0] ?? '')
  const args = tokens.slice(1)
  if (executable === '' || executable.startsWith('#')) return undefined

  if (SHELLS.has(executable) && depth < 2) {
    const commandFlag = args.findIndex(arg => {
      const normalized = arg.toLowerCase()
      return ['-c', '-command', '/c'].includes(normalized)
        || (!['cmd', 'powershell', 'pwsh'].includes(executable)
          && /^-[a-z]{2,5}$/u.test(normalized)
          && normalized.includes('c'))
    })
    const nested = commandFlag === -1 ? undefined : args[commandFlag + 1]
    if (nested !== undefined) return detectDangerousCommand(nested, depth + 1)
  }

  if (executable === 'rm' && (hasShortFlag(args, 'r') || hasShortFlag(args, 'f')
    || args.includes('--recursive') || args.includes('--force'))) {
    return hazard('recursive-or-force-delete', 'recursive or forced deletion requires approval', segment)
  }
  if (executable === 'rmdir' && (hasShortFlag(args, 'p') || args.includes('--parents'))) {
    return hazard('recursive-directory-delete', 'recursive directory deletion requires approval', segment)
  }
  if (executable === 'git' && executableName(args[0] ?? '') === 'reset' && args.includes('--hard')) {
    return hazard('git-reset-hard', 'discarding Git working-tree changes requires approval', segment)
  }
  if (executable === 'git' && executableName(args[0] ?? '') === 'clean'
    && (hasShortFlag(args.slice(1), 'f') || args.slice(1).includes('--force'))) {
    return hazard('git-clean-force', 'forced removal of untracked files requires approval', segment)
  }
  if (executable === 'mkfs' || executable.startsWith('mkfs.')) {
    return hazard('filesystem-format', 'formatting a filesystem requires approval', segment)
  }
  if (executable === 'dd' && args.some(arg => arg.toLowerCase().startsWith('of='))) {
    return hazard('raw-output-write', 'raw block or file overwrite requires approval', segment)
  }
  if (executable === 'diskutil' && ['erase', 'erasedisk', 'erasevolume', 'partitiondisk', 'secureerase']
    .includes((args[0] ?? '').toLowerCase())) {
    return hazard('disk-erase', 'disk erase or repartition requires approval', segment)
  }
  if ((executable === 'chmod' || executable === 'chown')
    && (hasShortFlag(args, 'r') || args.includes('--recursive'))) {
    return hazard('recursive-permission-change', 'recursive ownership or permission change requires approval', segment)
  }
  if (executable === 'pkill') {
    return hazard('process-kill', 'pattern-based process termination requires approval', segment)
  }
  if (executable === 'kill' && (args.some(arg => ['-9', '-kill'].includes(arg.toLowerCase()))
    || args.some((arg, index) => ['-s', '--signal'].includes(arg.toLowerCase())
      && (args[index + 1] ?? '').toLowerCase() === 'kill'))) {
    return hazard('force-kill', 'untrappable process termination requires approval', segment)
  }
  if (['remove-item', 'del', 'erase', 'rd', 'rmdir'].includes(executable)
    && args.some(arg => ['-recurse', '-force'].includes(arg.toLowerCase()))) {
    return hazard('powershell-force-delete', 'PowerShell recursive or forced deletion requires approval', segment)
  }
  if (executable === 'stop-process' && args.some(arg => arg.toLowerCase() === '-force')) {
    return hazard('powershell-force-stop', 'forced process termination requires approval', segment)
  }
  return undefined
}

export function detectDangerousCommand(command: string, depth = 0): CommandHazard | undefined {
  for (const segment of splitCommandSegments(command)) {
    const found = inspectTokens(tokenizeCommand(segment), segment, depth)
    if (found !== undefined) return found
  }
  return undefined
}

export async function decideCommand(
  exec: Pick<ToolExecution, 'name' | 'arguments'>,
  next: () => Promise<PreToolDecision>,
): Promise<PreToolDecision> {
  if (exec.name !== 'bash' && exec.name !== 'pwsh') return next()
  if (exec.arguments === null || typeof exec.arguments !== 'object') return next()
  const command = (exec.arguments as { command?: unknown }).command
  if (typeof command !== 'string') return next()
  const found = detectDangerousCommand(command)
  if (found === undefined) return next()
  return { kind: 'ask', reason: `Convax Comic command guard: ${found.reason} (${found.code})` }
}

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', (exec, next) => decideCommand(exec, next))
}
