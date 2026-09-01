import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { BEUI_COMPONENT_CSS, BEUI_THEME_CSS } from '../src/index.js'

const fileTreeSource = await readFile(new URL('../src/file-tree.tsx', import.meta.url), 'utf8')
const selectSource = await readFile(new URL('../src/select.tsx', import.meta.url), 'utf8')

describe('BeUI theme contract', () => {
  it('maps official BeUI roles without overwriting DSH token ownership', () => {
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-background: var(--dsw-alias-bg-base')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-neutral-surface: color-mix(in oklab, var(--cvx-beui-foreground) 3%, var(--cvx-beui-background))')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-card: var(--cvx-beui-neutral-surface)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-popover: var(--cvx-beui-neutral-surface)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-secondary: var(--cvx-beui-neutral-surface)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-muted: var(--cvx-beui-neutral-surface)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-primary: var(--dsw-alias-brand-primary, #18181b)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-primary-foreground: var(--dsw-alias-label-primary-foreground, #ffffff)')
    expect(BEUI_THEME_CSS).toContain('--cvx-beui-ring: color-mix(in oklab, var(--cvx-beui-foreground) 12%, transparent)')
    expect(BEUI_THEME_CSS).toMatch(/body\[data-ds-dark-theme\][^{]*\{[^}]*--cvx-beui-primary:\s*var\(--dsw-alias-brand-primary, #f4f4f5\)[^}]*--cvx-beui-muted-foreground:\s*color-mix\(in oklab, var\(--dsw-alias-label-secondary, #a1a1aa\) 64%, var\(--cvx-beui-background\)\)/su)
    expect(BEUI_THEME_CSS).not.toContain('var(--dsw-alias-bg-overlay')
    expect(BEUI_THEME_CSS).not.toMatch(/#5f7f00|#c6f22d/u)
    expect(BEUI_THEME_CSS).not.toMatch(/--dsw-alias-bg-base\s*:/u)
  })

  it('ships focus, reduced-motion, and file-tree selection styles', () => {
    expect(BEUI_THEME_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(BEUI_COMPONENT_CSS).toContain('.cvxBeuiButton:focus-visible')
    expect(BEUI_COMPONENT_CSS).toContain('.cvxBeuiFileTreeSelection')
  })

  it('keeps Select on the official base, muted, and motion semantics', () => {
    expect(BEUI_COMPONENT_CSS).toMatch(/\.cvxBeuiSelectTrigger\s*\{[^}]*background:\s*var\(--cvx-beui-background\)[^}]*font-size:\s*14px[^}]*font-weight:\s*400/su)
    expect(BEUI_COMPONENT_CSS).toMatch(/\.cvxBeuiSelectMenu\s*\{[^}]*border-radius:\s*12px[^}]*background:\s*var\(--cvx-beui-background\)/su)
    expect(BEUI_COMPONENT_CSS).toMatch(/\.cvxBeuiSelectOption\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--cvx-beui-muted\)/su)
    expect(BEUI_COMPONENT_CSS).toMatch(/\.cvxBeuiSelectCheck\s*\{[^}]*color:\s*currentColor/u)
    expect(BEUI_COMPONENT_CSS).not.toMatch(/\.cvxBeuiSelectMenu\s*\{[^}]*var\(--cvx-beui-popover\)/su)
    expect(BEUI_COMPONENT_CSS).not.toMatch(/\.cvxBeuiSelectOption\[aria-selected="true"\]\s*\{[^}]*var\(--cvx-beui-accent\)/su)
    expect(selectSource).toContain('Source: https://beui.dev/components/motion/select')
    expect(selectSource).toContain('new ResizeObserver(measure)')
    expect(selectSource).toContain("staggerChildren: 0.035")
    expect(selectSource).toContain("setPlacement(below < contentHeight + 16 && above > below ? 'top' : 'bottom')")
    expect(selectSource).not.toContain("from './button.js'")
  })

  it('removes collapsed rows from layout synchronously instead of retaining blank space', () => {
    expect(fileTreeSource).toContain('{rows.map(row => {')
    expect(fileTreeSource).not.toMatch(/<AnimatePresence[^>]*>\s*\{rows\.map/su)
    expect(fileTreeSource).not.toContain("layout={reduce ? false : 'position'}")
    expect(fileTreeSource).not.toContain("exit: { opacity: 0, y: -4 }")
  })

  it('only measures shared selection motion when the selected row changes', () => {
    expect(fileTreeSource).toContain('layoutDependency={selectedId}')
    expect(fileTreeSource).toContain('layoutDependency={hoveredId}')
  })
})
