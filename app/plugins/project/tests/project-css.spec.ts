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
  it('uses one neutral surface across the complete sidebar', () => {
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-ink:[^;]+#1b1d1a/u)
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-sidebar:\s*var\(--dsw-specific-sidebar-fill, var\(--cvx-project-panel\)\)/u)
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-accent:\s*var\(--cvx-beui-primary, #18181b\)/u)
    expect(rule('.cvxProjectSidebar')).toMatch(/background:\s*var\(--cvx-project-sidebar\)/u)
    expect(rule('.cvxProjectNavigator')).toMatch(/background:\s*var\(--cvx-project-sidebar\)/u)
    expect(rule('.cvxProjectChildren')).toMatch(/background:\s*var\(--cvx-project-sidebar\)/u)
    expect(rule('.cvxProjectChildren .cvxTreeSection > header')).toMatch(/background:\s*var\(--cvx-project-sidebar\)/u)
    expect(rule('.cvxProjectChildren .cvxTreeItemActive')).toMatch(/background:\s*var\(--cvx-project-hover\)/u)
    expect(css).not.toMatch(/#5c7a00|#c6f22d/u)
  })

  it('keeps the Canvas center on a visible product surface', () => {
    expect(rule('.cvxProjectCenter')).toMatch(/background:\s*var\(--cvx-project-base\)/u)
    expect(css).not.toContain('var(--color-background-soft,#17181d)')
  })

  it('uses the unmodified BeUI project picker and removes the upstream New Session row', () => {
    expect(rule('.cvxProjectWorkspaceSelect')).toMatch(/flex:\s*1/u)
    expect(css).not.toContain('.cvxProjectWorkspaceSelect .cvxBeuiSelectTrigger')
    expect(rule('.cvxProjectSidebar button[aria-label="新建会话"]:not(:has([data-slot="sidebar.brand.mark"])),\n.cvxProjectSidebar button[aria-label="New session"]:not(:has([data-slot="sidebar.brand.mark"]))')).toMatch(/display:\s*none/u)
  })

  it('keeps Files and Canvases independently scrollable without simultaneous chrome', () => {
    expect(rule('.cvxProjectFileSection')).toMatch(/max-height:\s*calc\(100% - 36px\)/u)
    expect(rule('.cvxProjectFileSection')).toMatch(/flex:\s*0 1 auto/u)
    expect(rule('.cvxProjectFiles')).toMatch(/overflow-x:\s*hidden/u)
    expect(rule('.cvxProjectFiles')).toMatch(/overflow-y:\s*auto/u)
    expect(rule('.cvxProjectChildren')).toMatch(/overflow-x:\s*hidden/u)
    expect(rule('.cvxProjectChildren')).toMatch(/overflow-y:\s*auto/u)
    expect(rule('.cvxProjectFiles,\n.cvxProjectChildren')).toMatch(/scrollbar-color:\s*transparent transparent/u)
    expect(rule('.cvxProjectFiles:hover,\n.cvxProjectChildren:hover')).toMatch(/scrollbar-color:\s*var\(--cvx-project-line-strong\) transparent/u)
    expect(rule('.cvxProjectFiles[hidden]')).toMatch(/display:\s*none/u)
  })

  it('keeps the Agent titlebar draggable and its controls clickable', () => {
    expect(rule('.cvxProjectAgent > header')).toMatch(/-webkit-app-region:\s*drag/u)
    expect(rule('.cvxProjectAgentActions')).toMatch(/-webkit-app-region:\s*no-drag/u)
    expect(rule('.cvxProjectOverlay [data-slot="shell.overlay"],\n.cvxProjectOverlay [data-slot="shell.overlay"] > *')).toMatch(/pointer-events:\s*auto/u)
    expect(css).toMatch(/\.cvxProjectAgentReopen\s*\{[^}]*z-index:\s*90/su)
    expect(rule('.cvxProjectAgentToggle,\n.cvxProjectAgentReopen')).toMatch(/pointer-events:\s*auto/u)
    expect(rule('.cvxProjectAgentToggle.cvxBeuiButton[data-size="icon"]')).toMatch(/width:\s*28px/u)
    expect(rule('.cvxProjectAgentToggle.cvxBeuiButton[data-size="icon"]')).toMatch(/border-radius:\s*50%/u)
  })

  it('provides accessible full-height drag targets on both panel boundaries', () => {
    expect(rule('.cvxProjectResizeHandle')).toMatch(/position:\s*absolute/u)
    expect(rule('.cvxProjectResizeHandle')).toMatch(/width:\s*8px/u)
    expect(rule('.cvxProjectResizeHandle')).toMatch(/cursor:\s*col-resize/u)
    expect(rule('.cvxProjectResizeHandle')).toMatch(/touch-action:\s*none/u)
    expect(rule('.cvxProjectResizeHandle')).toMatch(/-webkit-app-region:\s*no-drag/u)
    expect(rule('.cvxProjectResizeHandle[data-side="sidebar"]')).toMatch(/left:\s*calc\(var\(--cvx-sidebar, 300px\) - 4px\)/u)
    expect(rule('.cvxProjectResizeHandle[data-side="agent"]')).toMatch(/right:\s*calc\(var\(--cvx-agent, 380px\) - 4px\)/u)
    expect(rule('.cvxProjectResizeHandle:hover::after,\n.cvxProjectResizeHandle:focus-visible::after,\n.cvxProjectShell[data-resizing="sidebar"] .cvxProjectResizeHandle[data-side="sidebar"]::after,\n.cvxProjectShell[data-resizing="agent"] .cvxProjectResizeHandle[data-side="agent"]::after')).toMatch(/width:\s*2px[^}]*background:\s*var\(--cvx-project-line-strong\)/su)
    expect(rule('.cvxProjectResizeHandle:focus-visible')).toMatch(/var\(--cvx-project-line-strong\)/u)
    expect(rule('.cvxProjectShell[data-resizing]')).toMatch(/transition:\s*none/u)
  })

  it('returns collapsed panel columns to the Canvas surface', () => {
    expect(rule('.cvxProjectShell')).toMatch(/grid-template-columns:\s*var\(--cvx-sidebar, 300px\) minmax\(0, 1fr\) var\(--cvx-agent, 380px\)/u)
    expect(rule('.cvxProjectAgentSeat[data-collapsed]')).toMatch(/visibility:\s*hidden/u)
  })
})
