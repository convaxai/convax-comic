import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = await readFile(new URL('../src/client/components.tsx', import.meta.url), 'utf8')

describe('Project file tree presentation', () => {
  it('uses BEUI tree primitives while preserving project-specific behavior', () => {
    expect(source).toMatch(/import \{[^}]*FileTree[^}]*FileTreeFile[^}]*FileTreeFolder[^}]*\} from '@convax\/beui'/su)
    expect(source).toContain('<FileTreeFolder key={entry.path} value={entry.path} name={entry.name} icon={icon}>')
    expect(source).toContain('<ProjectEntryIcon entry={entry} expanded={open} />')
    expect(source).toContain("disabled={entry.kind === 'symlink'}")
    expect(source).toContain('expandedIds={snapshot.expanded}')
    expect(source).toContain('onExpandedChange={changeExpanded}')
    expect(source).toContain('runtime.toggleDirectory(path)')
    expect(source).toContain("draggable={entry.kind === 'file'}")
    expect(source).toContain('event.dataTransfer.setData(PROJECT_FILE_DRAG_MIME')
    expect(source).toContain('encodeProjectFileDragPayload({')
    expect(source).toContain('workspaceId,')
    expect(source).toContain('path: entry.path,')
    expect(source).not.toContain('name: entry.name')
  })

  it('keeps section collapse and the nested canvases seat around the tree', () => {
    expect(source).toContain('aria-expanded={filesExpanded}')
    expect(source).toContain('hidden={!filesExpanded}')
    expect(source).not.toContain('cvxProjectNavigatorScroll')
    expect(source).toContain("renderSlot('project.canvases', { project: runtime })")
  })

  it('uses the BEUI project picker instead of a native select', () => {
    expect(source).toMatch(/import \{[^}]*Select[^}]*\} from '@convax\/beui'/su)
    expect(source).toContain('<Select')
    expect(source).toContain('ariaLabel="Active project"')
    expect(source).toContain('onValueChange={(workspaceId) => { run(runtime.switchWorkspace(workspaceId)) }}')
    expect(source).not.toContain('<select')
    expect(source).not.toContain('<option')
  })

  it('leaves global BEUI CSS to the UI owner and uses Button on safe Project and Agent actions', () => {
    expect(source).toContain('return <style>{css}</style>')
    expect(source).not.toContain('BEUI_THEME_CSS')
    expect(source).not.toContain('BEUI_COMPONENT_CSS')
    expect(source).toMatch(/<Button[^>]+aria-label="Add project"[^>]*>/u)
    expect(source).toContain('aria-label="Collapse Agent panel"')
    expect(source).toContain('<Button variant="secondary" size="sm" className="cvxProjectAgentAction"')
    expect(source.match(/<Button\b/gu)).toHaveLength(3)
  })
})
