import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  decideCommand,
  detectDangerousCommand,
  splitCommandSegments,
  tokenizeCommand,
} from '../src/index.ts'
import * as CommandGuard from '../src/index.ts'

const FIBER_PENDING = 0
const FIBER_ACTIVE = 2

describe('command analysis', () => {
  it('recognizes high-confidence destructive POSIX commands', () => {
    for (const command of [
      'rm -rf build',
      'sudo rm --recursive old',
      'git reset --hard HEAD',
      'git clean -fdx',
      'mkfs.ext4 /dev/disk4',
      'dd if=image.iso of=/dev/disk4',
      'diskutil eraseDisk APFS Empty /dev/disk4',
      'chmod -R 777 .',
      'chown --recursive user .',
      'kill -9 123',
      'pkill node',
    ]) expect(detectDangerousCommand(command), command).toBeDefined()
  })

  it('recognizes PowerShell destructive commands case-insensitively', () => {
    expect(detectDangerousCommand('Remove-Item target -Recurse')).toBeDefined()
    expect(detectDangerousCommand('rmdir target -Force')).toBeDefined()
    expect(detectDangerousCommand('Stop-Process -Id 42 -Force')).toBeDefined()
  })

  it('checks every unquoted command segment and nested shell command', () => {
    expect(splitCommandSegments('echo ok && git clean -fd | cat')).toEqual(['echo ok', 'git clean -fd', 'cat'])
    expect(splitCommandSegments('echo ok & rm -rf cache')).toEqual(['echo ok', 'rm -rf cache'])
    expect(detectDangerousCommand('echo ok && git clean -fd')).toMatchObject({ code: 'git-clean-force' })
    expect(detectDangerousCommand('echo ok & rm -rf cache')).toMatchObject({ code: 'recursive-or-force-delete' })
    expect(detectDangerousCommand("bash -c 'rm -rf cache'")).toMatchObject({ code: 'recursive-or-force-delete' })
    expect(detectDangerousCommand("bash -lc 'git reset --hard HEAD'")).toMatchObject({ code: 'git-reset-hard' })
    expect(detectDangerousCommand('pwsh.exe -Command "Remove-Item cache -Recurse"'))
      .toMatchObject({ code: 'powershell-force-delete' })
  })

  it('does not treat quoted data or ordinary commands as executable hazards', () => {
    expect(splitCommandSegments('printf "%s" "rm -rf /; git reset --hard"')).toHaveLength(1)
    expect(tokenizeCommand('echo "rm -rf /"')).toEqual(['echo', 'rm -rf /'])
    for (const command of [
      'echo "rm -rf /"',
      'printf "%s" "git reset --hard"',
      'rm one-file.txt',
      'git reset --soft HEAD~1',
      'git clean -n',
      'kill -15 123',
      'chmod 644 file',
    ]) expect(detectDangerousCommand(command), command).toBeUndefined()
  })
})

describe('Cordis policy hook', () => {
  it('asks for dangerous shell commands and delegates all other calls', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    await expect(decideCommand({ name: 'bash', arguments: { command: 'rm -rf out' } } as never, next))
      .resolves.toMatchObject({ kind: 'ask', reason: expect.stringContaining('requires approval') })
    expect(next).not.toHaveBeenCalled()

    await expect(decideCommand({ name: 'bash', arguments: { command: 'ls -la' } } as never, next))
      .resolves.toEqual({ kind: 'allow' })
    await expect(decideCommand({ name: 'read_file', arguments: {} } as never, next))
      .resolves.toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('follows the tools provider lifecycle through inject', async () => {
    const ctx = new Context()
    const guard = ctx.plugin(CommandGuard)
    expect(guard.state).toBe(FIBER_PENDING)
    const providerPlugin = {
      name: 'test-tools-provider',
      apply(inner: Context) { inner.provide('tools', {}) },
    }
    const provider = await ctx.plugin(providerPlugin)
    await guard
    expect(guard.state).toBe(FIBER_ACTIVE)
    expect(guard.ctx.fiber.getEffects().length).toBeGreaterThan(0)

    await provider.dispose()
    await vi.waitFor(() => { expect(guard.state).toBe(FIBER_PENDING) })
    expect(guard.ctx.fiber.getEffects()).toEqual([])

    const restored = await ctx.plugin(providerPlugin)
    await guard
    expect(guard.state).toBe(FIBER_ACTIVE)
    await restored.dispose()
    await guard.dispose()
  })
})
