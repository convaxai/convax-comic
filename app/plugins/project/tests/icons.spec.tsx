import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectFileEntry } from '../src/contracts.js'
import {
  PanelRightIcon,
  ProjectEntryIcon,
  ProjectsIcon,
  projectEntryMediaKind,
  projectEntryPreviewKind,
} from '../src/client/icons.js'

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

  it('renders the compact project rail as an accessible grid glyph', () => {
    const projects = renderToStaticMarkup(<ProjectsIcon size={18} />)
    expect(projects).toContain('width="18"')
    expect(projects).toContain('height="18"')
    expect(projects.match(/<rect/gu)).toHaveLength(3)
    expect(projects).toContain('M14 17.5h7M17.5 14v7')
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
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('clip.mp4', 'file')} expanded={false} />)).toContain('cvxProjectIconVideo')
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('theme.ts', 'file')} expanded={false} />)).toContain('cvxProjectIconCode')
    expect(renderToStaticMarkup(<ProjectEntryIcon entry={entry('PROJECT.md', 'file')} expanded={false} />)).toContain('cvxProjectIconMuted')
    expect(projectEntryMediaKind('STILL.WEBP')).toBe('image')
    expect(projectEntryMediaKind('clip.MOV')).toBe('video')
    expect(projectEntryMediaKind('notes.md')).toBeUndefined()
    expect(projectEntryPreviewKind('notes.md')).toBe('text')
    expect(renderToStaticMarkup(
      <ProjectEntryIcon entry={entry('still.png', 'file')} expanded={false} previewUrl="blob:thumb" />,
    )).toContain('class="cvxProjectFileThumbnail"')
  })
})
