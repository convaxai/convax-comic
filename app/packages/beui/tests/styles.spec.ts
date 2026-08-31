import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '../src/index.js'

const fileTreeSource = await readFile(new URL('../src/file-tree.tsx', import.meta.url), 'utf8')

describe('BeUI theme contract', () => {
  it('maps semantic tokens without overwriting DSH token ownership', () => {
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-background: var(--dsw-alias-bg-base')
    expect(BEUI_THEME_CSS).not.toMatch(/--dsw-alias-bg-base\s*:/u)
  })

  it('ships focus, reduced-motion, and file-tree selection styles', () => {
    expect(BEUI_THEME_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(BEUI_COMPONENT_CSS).toContain('.cvxBeuiButton:focus-visible')
    expect(BEUI_COMPONENT_CSS).toContain('.cvxBeuiFileTreeSelection')
  })

  it('removes collapsed rows from layout synchronously instead of retaining blank space', () => {
    expect(fileTreeSource).toContain('{rows.map(row => {')
    expect(fileTreeSource).not.toMatch(/<AnimatePresence[^>]*>\s*\{rows\.map/su)
    expect(fileTreeSource).not.toContain("layout={reduce ? false : 'position'}")
    expect(fileTreeSource).not.toContain("exit: { opacity: 0, y: -4 }")
  })
})
