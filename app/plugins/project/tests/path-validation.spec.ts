import { describe, expect, it } from 'vitest'
import { assertProjectRelativePath, joinProjectPath } from '../src/contracts.ts'

describe('project relative path contract', () => {
  it('accepts only strict relative slash paths', () => {
    for (const path of ['', 'src', 'src/client/index.ts', '.config/file']) {
      expect(() => { assertProjectRelativePath(path) }).not.toThrow()
    }
    for (const path of ['/', '/etc', 'src/', './src', 'src/../secret', 'src//file', 'src\\file', 'a\0b']) {
      expect(() => { assertProjectRelativePath(path) }).toThrowError(/path/i)
    }
  })

  it('joins only basename children', () => {
    expect(joinProjectPath('', 'src')).toBe('src')
    expect(joinProjectPath('src', 'index.ts')).toBe('src/index.ts')
    expect(() => joinProjectPath('src', '../secret')).toThrow()
    expect(() => joinProjectPath('', 'a/b')).toThrow()
  })
})
