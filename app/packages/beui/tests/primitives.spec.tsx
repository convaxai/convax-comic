import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  AnimatedSidebar,
  AnimatedSidebarMenuItem,
  AnimatedSidebarSubmenu,
  Button,
  ChatApp,
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
  it('renders an externally controlled Animated Sidebar surface', () => {
    const expanded = renderToStaticMarkup(
      <AnimatedSidebar aria-label="Projects" collapsed={false} width={300}>Navigation</AnimatedSidebar>,
    )
    const collapsed = renderToStaticMarkup(
      <AnimatedSidebar aria-label="Projects" collapsed width={56}>Navigation</AnimatedSidebar>,
    )
    expect(expanded).toContain('data-slot="animated-sidebar"')
    expect(expanded).toContain('data-state="expanded"')
    expect(expanded).toContain('data-width="300"')
    expect(expanded).toContain('--cvx-beui-animated-sidebar-width:300px')
    expect(collapsed).toContain('data-state="collapsed"')
    expect(collapsed).toContain('data-width="56"')
    expect(collapsed).toContain('cvxBeuiAnimatedSidebarGlow')
  })

  it('renders an expanded first-level Animated Sidebar menu item', () => {
    const markup = renderToStaticMarkup(
      <AnimatedSidebarMenuItem
        label="Files"
        icon={<span>F</span>}
        meta={3}
        expanded
        onToggle={() => undefined}
      />,
    )
    expect(markup).toContain('cvxBeuiAnimatedSidebarMenuItem')
    expect(markup).toContain('data-expanded="true"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('cvxBeuiAnimatedSidebarMenuIcon')
    expect(markup).toContain('cvxBeuiAnimatedSidebarMenuChevron')
    expect(markup).toContain('Files')
  })

  it('renders the compact Animated Sidebar section variant without a leading icon', () => {
    const markup = renderToStaticMarkup(
      <AnimatedSidebarMenuItem
        variant="section"
        label="Files"
        meta={3}
        expanded
        onToggle={() => undefined}
      />,
    )
    expect(markup).toContain('data-variant="section"')
    expect(markup).not.toContain('cvxBeuiAnimatedSidebarMenuIcon')
    expect(markup).toContain('Files')
  })

  it('uses beUI pop-layout submenu mounting instead of retaining a zero-height flex child', () => {
    const collapsed = renderToStaticMarkup(
      <AnimatedSidebarSubmenu expanded={false}><button type="button">Nested</button></AnimatedSidebarSubmenu>,
    )
    const expanded = renderToStaticMarkup(
      <AnimatedSidebarSubmenu expanded><button type="button">Nested</button></AnimatedSidebarSubmenu>,
    )
    expect(collapsed).toBe('')
    expect(expanded).toContain('cvxBeuiAnimatedSidebarSubmenu')
    expect(expanded).toContain('data-expanded="true"')
    expect(expanded).toContain('Nested')
  })

  it('keeps Chat App conversation content mounted behind narrow-shell navigation', () => {
    const closed = renderToStaticMarkup(
      <ChatApp navigation={<button type="button">History row</button>} navigationOpen={false}>
        <div data-conversation="official">Conversation</div>
      </ChatApp>,
    )
    const open = renderToStaticMarkup(
      <ChatApp navigation={<button type="button">History row</button>} navigationOpen navigationLabel="Conversation history">
        <div data-conversation="official">Conversation</div>
      </ChatApp>,
    )
    expect(closed).toContain('data-slot="chat-app"')
    expect(closed).toContain('data-navigation-state="closed"')
    expect(closed).not.toContain('data-slot="chat-app-navigation"')
    expect(open).toContain('data-navigation-state="open"')
    expect(open).toContain('data-slot="chat-app-navigation"')
    expect(open).toContain('aria-label="Conversation history"')
    expect(open).toContain('aria-hidden="true"')
    expect(open).toContain('data-conversation="official"')
  })

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
    expect(markup).toContain('lucide-folder-open')
    expect(markup).toContain('lucide-file')
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
