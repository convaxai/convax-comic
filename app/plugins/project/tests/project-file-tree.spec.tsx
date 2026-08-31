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
  })

  it('keeps section collapse and the nested canvases seat around the tree', () => {
    expect(source).toContain('aria-expanded={filesExpanded}')
    expect(source).toContain('hidden={!filesExpanded}')
    expect(source).toContain("renderSlot('project.canvases', { project: runtime })")
  })

  it('injects BEUI CSS and uses Button on safe Project and Agent actions', () => {
    expect(source).toContain('<style>{BEUI_THEME_CSS}</style><style>{BEUI_COMPONENT_CSS}</style><style>{css}</style>')
    expect(source).toMatch(/<Button[^>]+aria-label="Add project"[^>]*>/u)
    expect(source).toContain('aria-label="Collapse Agent panel"')
    expect(source).toContain('<Button variant="secondary" size="sm" className="cvxProjectAgentAction"')
    expect(source.match(/<Button\b/gu)).toHaveLength(3)
  })
})
