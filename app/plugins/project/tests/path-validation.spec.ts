import { describe, expect, it } from 'vitest'
import {
  assertProjectRelativePath,
  encodeProjectFileDragPayload,
  joinProjectPath,
  parseProjectFileDragPayload,
} from '../src/contracts.ts'

describe('project relative path contract', () => {
  it('accepts only strict relative slash paths', () => {
    for (const path of ['', 'src', 'src/client/index.ts', '.config/file']) {
      expect(() => { assertProjectRelativePath(path) }).not.toThrow()
    }
    for (const path of ['/', '/etc', 'src/', './src', 'src/../secret', 'src//file', 'src\\file', 'a\0b']) {
      expect(() => { assertProjectRelativePath(path) }).toThrowError(/path/i)
    }
  })

  it('round-trips exact project file drag references without file metadata', () => {
    const encoded = encodeProjectFileDragPayload({ workspaceId: 'workspace-1', path: 'art/cover.png' })
    expect(JSON.parse(encoded)).toEqual({ workspaceId: 'workspace-1', path: 'art/cover.png' })
    expect(parseProjectFileDragPayload(encoded)).toEqual({ workspaceId: 'workspace-1', path: 'art/cover.png' })
    for (const invalid of [
      '{}',
      '{"workspaceId":"workspace-1","path":"../secret"}',
      '{"workspaceId":"workspace-1","path":"art/cover.png","name":"cover.png"}',
      JSON.stringify({ workspaceId: 'workspace-1', path: `a${'/b'.repeat(2048)}` }),
    ]) expect(() => parseProjectFileDragPayload(invalid)).toThrow()
  })

  it('joins only basename children', () => {
    expect(joinProjectPath('', 'src')).toBe('src')
    expect(joinProjectPath('src', 'index.ts')).toBe('src/index.ts')
    expect(() => joinProjectPath('src', '../secret')).toThrow()
    expect(() => joinProjectPath('', 'a/b')).toThrow()
  })
})
