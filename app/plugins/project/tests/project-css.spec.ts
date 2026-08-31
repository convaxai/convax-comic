import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const css = await readFile(new URL('../src/client/styles.css', import.meta.url), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'u'))
  if (match?.[1] === undefined) throw new Error(`missing CSS rule: ${selector}`)
  return match[1]
}

describe('Project shell visual contract', () => {
  it('uses matching semantic foreground and surface tokens', () => {
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-ink:[^;]+#1b1d1a/u)
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-panel:[^;]+#fbfaf7/u)
    expect(rule('.cvxProjectNavigator')).toMatch(/color:\s*var\(--cvx-project-ink\)/u)
    expect(rule('.cvxProjectNavigator')).toMatch(/background:\s*var\(--cvx-project-panel\)/u)
  })

  it('keeps the Canvas center on a visible product surface', () => {
    expect(rule('.cvxProjectCenter')).toMatch(/background:\s*var\(--cvx-project-base\)/u)
    expect(css).not.toContain('var(--color-background-soft,#17181d)')
  })

  it('keeps injected sidebar sections in the same unframed flex flow', () => {
    expect(rule('.cvxProjectFileSection')).toMatch(/flex:\s*1 1 auto/u)
    expect(rule('.cvxProjectChildren')).toMatch(/min-height:\s*36px/u)
    expect(rule('.cvxProjectChildren')).toMatch(/flex:\s*0 1 auto/u)
    expect(rule('.cvxProjectChildren')).not.toMatch(/border-top|max-height/u)
  })

  it('keeps overlay and collapsed Agent controls clickable', () => {
    expect(rule('.cvxProjectOverlay [data-slot="shell.overlay"],\n.cvxProjectOverlay [data-slot="shell.overlay"] > *')).toMatch(/pointer-events:\s*auto/u)
    expect(css).toMatch(/\.cvxProjectAgentReopen\s*\{[^}]*z-index:\s*90/su)
    expect(rule('.cvxProjectAgentToggle,\n.cvxProjectAgentReopen')).toMatch(/pointer-events:\s*auto/u)
  })

  it('returns collapsed panel columns to the Canvas surface', () => {
    expect(rule('.cvxProjectShell')).toMatch(/grid-template-columns:\s*var\(--cvx-sidebar, 300px\) minmax\(0, 1fr\) var\(--cvx-agent, 380px\)/u)
    expect(rule('.cvxProjectAgentSeat[data-collapsed]')).toMatch(/visibility:\s*hidden/u)
  })
})
