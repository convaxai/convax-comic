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
  it('separates first-level Animated Sidebar items from second-level File Trees', () => {
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-ink:[^;]+#1b1d1a/u)
    expect(rule('.cvxProjectShell')).toMatch(/--cvx-project-accent:\s*var\(--cvx-beui-primary, #18181b\)/u)
    expect(rule('.cvxProjectShell')).toMatch(/grid-template-columns 300ms cubic-bezier\(\.32, \.72, 0, 1\)/u)
    expect(rule('.cvxProjectSidebar')).toMatch(/--cvx-sidebar-item-height:\s*34px[^}]*--cvx-sidebar-item-gap:\s*2px[^}]*--cvx-sidebar-item-radius:\s*10px/su)
    expect(rule('.cvxProjectSidebar')).toMatch(/background:\s*var\(--cvx-project-base\)/u)
    expect(rule('.cvxProjectSidebar .cvxBeuiAnimatedSidebarContent > *,\n.cvxProjectSidebar .cvxBeuiAnimatedSidebarContent > [data-slot="sidebar"] > *')).toMatch(/background:\s*transparent/u)
    expect(rule('.cvxProjectNavigator')).toMatch(/background:\s*transparent/u)
    expect(rule('.cvxProjectSidebar .cvxBeuiFileTree')).toMatch(/gap:\s*var\(--cvx-sidebar-item-gap\)/u)
    expect(rule('.cvxProjectSidebar .cvxBeuiFileTree .cvxBeuiFileTreeItem')).toMatch(/height:\s*var\(--cvx-sidebar-item-height\)[^}]*border-radius:\s*var\(--cvx-sidebar-item-radius\)/su)
    expect(rule('.cvxProjectSidebar .cvxBeuiFileTree .cvxBeuiFileTreeChevron')).toMatch(/visibility:\s*hidden/u)
    expect(css).toMatch(/\.cvxProjectSidebar \.cvxBeuiFileTree \.cvxBeuiFileTreeSelection\s*\{[^}]*background:\s*var\(--cvx-sidebar-item-active\)/su)
    expect(rule('.cvxProjectSelector')).toMatch(/border-radius:\s*14px[^}]*background:\s*color-mix/su)
    expect(rule('.cvxProjectFileSection > .cvxProjectSectionItem')).toMatch(/width:\s*calc\(100% - 20px\)[^}]*flex:\s*0 0 36px[^}]*margin:\s*0 10px/su)
    expect(rule('.cvxProjectChildren')).toMatch(/background:\s*transparent/u)
    expect(rule('.cvxProjectChildren .cvxCanvasSectionItem[data-variant="section"][data-expanded]')).toMatch(/position:\s*sticky[^}]*top:\s*0[^}]*background:\s*var\(--cvx-project-base\)/su)
    expect(rule('.cvxProjectChildren .cvxCanvasSectionItem[data-variant="section"][data-expanded]:hover')).toMatch(/background:\s*color-mix\(in oklab, var\(--cvx-project-ink\) 4%, var\(--cvx-project-base\)\)/u)
    expect(rule('.cvxProjectFiles::before')).toMatch(/left:\s*26px[^}]*width:\s*1px/su)
    expect(rule('.cvxProjectChildren .cvxTreeSectionBody::before')).toMatch(/left:\s*18px[^}]*width:\s*1px/su)
    expect(rule('.cvxProjectSidebar .cvxBeuiFileTree .cvxBeuiFileTreeBranch')).toMatch(/linear-gradient\(to bottom/u)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.cvxProjectRailButton svg,[^}]*sidebar\.brand\.mark[^}]*transition:\s*none/su)
    expect(css).not.toContain('.cvxProjectChildren .cvxTreeItem')
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
    expect(rule('.cvxProjectFileSection[data-expanded]')).toMatch(/flex:\s*1 1 auto/u)
    expect(rule('.cvxProjectChildren:has(.cvxTreeSection[data-expanded])')).toMatch(/flex:\s*1 1 auto/u)
    expect(rule('.cvxProjectNavigator:has(> .cvxProjectFileSection[data-expanded]):has(> .cvxProjectChildren .cvxTreeSection[data-expanded]) > .cvxProjectFileSection,\n.cvxProjectNavigator:has(> .cvxProjectFileSection[data-expanded]):has(> .cvxProjectChildren .cvxTreeSection[data-expanded]) > .cvxProjectChildren')).toMatch(/flex-basis:\s*0/u)
    expect(rule('.cvxProjectFiles')).toMatch(/overflow-x:\s*hidden/u)
    expect(rule('.cvxProjectFiles')).toMatch(/overflow-y:\s*auto/u)
    expect(rule('.cvxProjectChildren')).toMatch(/overflow-x:\s*hidden/u)
    expect(rule('.cvxProjectChildren')).toMatch(/overflow-y:\s*auto/u)
    expect(rule('.cvxProjectFiles,\n.cvxProjectChildren')).toMatch(/scrollbar-color:\s*transparent transparent/u)
    expect(rule('.cvxProjectFiles:hover,\n.cvxProjectChildren:hover')).toMatch(/scrollbar-color:\s*var\(--cvx-project-line-strong\) transparent/u)
    expect(rule('.cvxProjectFilesMotion')).toMatch(/flex:\s*0 1 auto/u)
    expect(css).not.toContain('.cvxProjectFiles[hidden]')
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

  it('uses the BeUI Chat App inset and project-local history navigation', () => {
    expect(rule('.cvxProjectAgentBody > .cvxBeuiChatApp')).toMatch(/height:\s*100%/u)
    expect(rule('.cvxProjectAgentHistory')).toMatch(/height:\s*100%[^}]*flex-direction:\s*column/su)
    expect(rule('.cvxProjectAgentHistoryList')).toMatch(/overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/su)
    expect(rule('.cvxProjectAgentHistoryRow')).toMatch(/grid-template-columns:\s*8px minmax\(0, 1fr\) auto[^}]*border-radius:\s*12px/su)
    expect(rule('.cvxProjectAgentHistoryRow[aria-current="page"]')).toMatch(/background:\s*var\(--cvx-beui-muted/u)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.cvxProjectAgentHistoryRow,/su)
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
