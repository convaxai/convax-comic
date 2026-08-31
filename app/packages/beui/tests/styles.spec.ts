import { describe, expect, it } from 'vitest'
import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '../src/index.js'

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
})
