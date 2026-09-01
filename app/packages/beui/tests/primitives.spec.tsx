import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Button,
  FileTree,
  FileTreeFile,
  FileTreeFolder,
  Input,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../src/index.js'

function treeMarkup(): string {
  return renderToStaticMarkup(
    <FileTree defaultValue="app/index.ts" defaultExpandedIds={["app"]} ariaLabel="Project files">
      <FileTreeFolder value="app" name="app">
        <FileTreeFile value="app/index.ts" name="index.ts" draggable onDragStart={() => undefined} />
      </FileTreeFolder>
    </FileTree>,
  )
}

describe('BeUI source-owned primitives', () => {
  it('renders spring buttons through semantic variants', () => {
    const markup = renderToStaticMarkup(<Button variant="secondary" size="sm">Create</Button>)
    expect(markup).toContain('cvxBeuiButton')
    expect(markup).toContain('data-variant="secondary"')
    expect(markup).toContain('data-size="sm"')
  })

  it('renders an accessible expanded file tree', () => {
    const markup = treeMarkup()
    expect(markup).toContain('role="tree"')
    expect(markup).toContain('aria-label="Project files"')
    expect(markup).toContain('role="treeitem"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('index.ts')
    expect(markup).toContain('draggable="true"')
  })

  it('renders an accessible motion select trigger', () => {
    const select = renderToStaticMarkup(
      <Select
        ariaLabel="Active project"
        value="story"
        options={[{ value: 'story', label: 'Story' }, { value: 'draft', label: 'Draft' }]}
        onValueChange={() => undefined}
      />,
    )
    expect(select).toContain('cvxBeuiSelectTrigger')
    expect(select).toContain('aria-haspopup="listbox"')
    expect(select).toContain('aria-expanded="false"')
    expect(select).toContain('Story')
    expect(select).not.toContain('<select')
  })

  it('renders settings primitives with native accessibility semantics', () => {
    const input = renderToStaticMarkup(<Input label="Name" error="Required" reserveErrorLine />)
    const toggle = renderToStaticMarkup(<Switch checked ariaLabel="Snap" onCheckedChange={() => undefined} />)
    const tabs = renderToStaticMarkup(
      <Tabs defaultValue="general"><TabsList ariaLabel="Settings">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="models">Models</TabsTrigger>
      </TabsList><TabsContent value="general">Content</TabsContent></Tabs>,
    )
    expect(input).toContain('role="alert"')
    expect(input).toContain('aria-invalid="true"')
    expect(toggle).toContain('role="switch"')
    expect(toggle).toContain('aria-checked="true"')
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toContain('aria-selected="true"')
  })
})
