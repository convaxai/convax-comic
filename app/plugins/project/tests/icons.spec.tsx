import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectFileEntry } from '../src/contracts.js'
import { PanelRightIcon, ProjectEntryIcon } from '../src/client/icons.js'

function entry(name: string, kind: ProjectFileEntry['kind']): ProjectFileEntry {
  return { name, path: name, kind, expandable: kind === 'directory' }
}

describe('Convax project tree icons', () => {
  it('uses the matching open and closed folder line icons', () => {
    const closed = renderToStaticMarkup(<ProjectEntryIcon entry={entry('scenes', 'directory')} expanded={false} />)
    const open = renderToStaticMarkup(<ProjectEntryIcon entry={entry('scenes', 'directory')} expanded />)
    expect(closed).toContain('cvxProjectIconFolder')
    expect(open).toContain('cvxProjectIconFolder')
    expect(open).not.toBe(closed)
  })

  it('mirrors the official filled panel glyph for the right sidebar', () => {
    const panel = renderToStaticMarkup(<PanelRightIcon />)
    expect(panel).toContain('viewBox="0 0 16 16"')
    expect(panel).toContain('fill="currentColor"')
    expect(panel).toContain('transform="translate(16 0) scale(-1 1)"')
    expect(panel).not.toContain('<rect')
  })

  it('uses media and code colors while keeping documents muted', () => {
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('still.png', 'file')} expanded={false} />)).toContain('cvxProjectIconImage')
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('theme.ts', 'file')} expanded={false} />)).toContain('cvxProjectIconCode')
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('PROJECT.md', 'file')} expanded={false} />)).toContain('cvxProjectIconMuted')
  })
})
