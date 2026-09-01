// Adapted from beUI File Tree under the MIT license.
// Source: https://beui.dev/components/motion/file-tree
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react'
import {
  Children,
  Fragment,
  isValidElement,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { EASE_OUT, SPRING_LAYOUT, SPRING_SWAP } from './motion.js'

export interface FileTreeIconState {
  readonly type: 'file' | 'folder'
  readonly open: boolean
  readonly disabled: boolean
}

export type FileTreeIcon = ReactNode | ((state: FileTreeIconState) => ReactNode)

interface FileTreeItem {
  readonly value: string
  readonly name: string
  readonly type: 'file' | 'folder'
  readonly children?: readonly FileTreeItem[] | undefined
  readonly icon?: FileTreeIcon | undefined
  readonly disabled?: boolean | undefined
  readonly className?: string | undefined
  readonly draggable?: boolean | undefined
  readonly onDragStart?: ((event: DragEvent<HTMLButtonElement>) => void) | undefined
}

export interface FileTreeFolderProps {
  readonly value: string
  readonly name: string
  readonly icon?: FileTreeIcon
  readonly disabled?: boolean
  readonly children?: ReactNode
  readonly className?: string
}

export interface FileTreeFileProps {
  readonly value: string
  readonly name: string
  readonly icon?: FileTreeIcon
  readonly disabled?: boolean
  readonly className?: string
  readonly draggable?: boolean
  readonly onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
}

export interface FileTreeClassNames {
  readonly tree?: string
  readonly item?: string
  readonly icon?: string
  readonly label?: string
}

export interface FileTreeProps {
  readonly children: ReactNode
  readonly value?: string | null
  readonly defaultValue?: string | null
  readonly onValueChange?: (value: string) => void
  readonly expandedIds?: readonly string[]
  readonly defaultExpandedIds?: readonly string[]
  readonly onExpandedChange?: (expandedIds: readonly string[]) => void
  readonly ariaLabel?: string
  readonly indent?: number
  readonly className?: string
  readonly classNames?: FileTreeClassNames
}

interface FlatFileTreeItem {
  readonly item: FileTreeItem
  readonly depth: number
  readonly parentId: string | null
  readonly position: number
  readonly setSize: number
}

export function FileTreeFolder(_props: FileTreeFolderProps): null { return null }
export function FileTreeFile(_props: FileTreeFileProps): null { return null }

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function itemsFromChildren(children: ReactNode): readonly FileTreeItem[] {
  const items: FileTreeItem[] = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type === Fragment) {
      items.push(...itemsFromChildren((child.props as { children?: ReactNode }).children))
      return
    }
    if (child.type === FileTreeFolder) {
      const props = child.props as FileTreeFolderProps
      items.push({
        value: props.value,
        name: props.name,
        type: 'folder',
        icon: props.icon,
        disabled: props.disabled,
        className: props.className,
        children: itemsFromChildren(props.children),
      })
      return
    }
    if (child.type === FileTreeFile) {
      const props = child.props as FileTreeFileProps
      items.push({
        value: props.value,
        name: props.name,
        type: 'file',
        icon: props.icon,
        disabled: props.disabled,
        className: props.className,
        draggable: props.draggable,
        onDragStart: props.onDragStart,
      })
    }
  })
  return items
}

function flattenItems(
  items: readonly FileTreeItem[],
  expanded: ReadonlySet<string>,
  depth = 0,
  parentId: string | null = null,
): readonly FlatFileTreeItem[] {
  return items.flatMap((item, index) => {
    const row: FlatFileTreeItem = { item, depth, parentId, position: index + 1, setSize: items.length }
    if (item.type !== 'folder' || !expanded.has(item.value) || item.children?.length === 0) return [row]
    return [row, ...flattenItems(item.children ?? [], expanded, depth + 1, item.value)]
  })
}

function DefaultIcon({ item, open, reduce }: {
  readonly item: FileTreeItem
  readonly open: boolean
  readonly reduce: boolean
}): ReactNode {
  if (item.type === 'file') return <File size={16} />
  if (reduce) return open ? <FolderOpen size={16} /> : <Folder size={16} />
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={open ? 'open' : 'closed'}
        className="cvxBeuiFileTreeIconSwap"
        initial={{ opacity: 0, scale: 0.75, rotate: open ? -8 : 8 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, scale: 0.75, rotate: open ? 8 : -8 }}
        transition={SPRING_SWAP}
      >{open ? <FolderOpen size={16} /> : <Folder size={16} />}</motion.span>
    </AnimatePresence>
  )
}

function renderIcon(item: FileTreeItem, open: boolean, reduce: boolean): ReactNode {
  const state: FileTreeIconState = { type: item.type, open, disabled: item.disabled === true }
  if (typeof item.icon === 'function') return item.icon(state)
  return item.icon ?? <DefaultIcon item={item} open={open} reduce={reduce} />
}

export function FileTree({
  children,
  value,
  defaultValue = null,
  onValueChange,
  expandedIds,
  defaultExpandedIds = [],
  onExpandedChange,
  ariaLabel = 'Files',
  indent = 18,
  className,
  classNames,
}: FileTreeProps): ReactNode {
  const reduce = useReducedMotion() ?? false
  const uid = useId()
  const [internalValue, setInternalValue] = useState<string | null>(defaultValue)
  const [internalExpandedIds, setInternalExpandedIds] = useState<readonly string[]>(defaultExpandedIds)
  const [focusedId, setFocusedId] = useState<string | null>(value ?? defaultValue)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const selectedId = value === undefined ? internalValue : value
  const currentExpandedIds = expandedIds ?? internalExpandedIds
  const expanded = useMemo(() => new Set(currentExpandedIds), [currentExpandedIds])
  const items = useMemo(() => itemsFromChildren(children), [children])
  const rows = useMemo(() => flattenItems(items, expanded), [expanded, items])
  const focusedRow = focusedId !== null && rows.some(row => row.item.value === focusedId)
    ? focusedId
    : (rows[0]?.item.value ?? null)

  useEffect(() => {
    if (focusedId !== focusedRow) setFocusedId(focusedRow)
  }, [focusedId, focusedRow])

  const focusRow = useCallback((id: string) => {
    setFocusedId(id)
    const row = rowRefs.current.get(id)
    if (row !== undefined) row.focus()
    else requestAnimationFrame(() => { rowRefs.current.get(id)?.focus() })
  }, [])

  const selectItem = useCallback((item: FileTreeItem) => {
    if (item.disabled === true) return
    if (value === undefined) setInternalValue(item.value)
    onValueChange?.(item.value)
  }, [onValueChange, value])

  const setExpanded = useCallback((next: readonly string[]) => {
    if (expandedIds === undefined) setInternalExpandedIds(next)
    onExpandedChange?.(next)
  }, [expandedIds, onExpandedChange])

  const toggleFolder = useCallback((id: string) => {
    const next = new Set(currentExpandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(Array.from(next))
  }, [currentExpandedIds, setExpanded])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, row: FlatFileTreeItem) => {
    const index = rows.findIndex(candidate => candidate.item.value === row.item.value)
    const previous = rows[index - 1]
    const next = rows[index + 1]
    const isFolder = row.item.type === 'folder'
    const isOpen = expanded.has(row.item.value)
    if (event.key === 'ArrowDown' && next !== undefined) {
      event.preventDefault(); focusRow(next.item.value)
    } else if (event.key === 'ArrowUp' && previous !== undefined) {
      event.preventDefault(); focusRow(previous.item.value)
    } else if (event.key === 'Home' && rows[0] !== undefined) {
      event.preventDefault(); focusRow(rows[0].item.value)
    } else if (event.key === 'End' && rows.at(-1) !== undefined) {
      event.preventDefault(); focusRow(rows.at(-1)?.item.value ?? row.item.value)
    } else if (event.key === 'ArrowRight' && isFolder) {
      event.preventDefault()
      if (!isOpen && itemEnabled(row.item)) toggleFolder(row.item.value)
      else if (next?.parentId === row.item.value) focusRow(next.item.value)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      if (isFolder && isOpen && itemEnabled(row.item)) toggleFolder(row.item.value)
      else if (row.parentId !== null) focusRow(row.parentId)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!itemEnabled(row.item)) return
      selectItem(row.item)
      if (isFolder) toggleFolder(row.item.value)
    }
  }, [expanded, focusRow, rows, selectItem, toggleFolder])

  return (
    <motion.div
      role="tree"
      aria-label={ariaLabel}
      aria-multiselectable="false"
      className={classes('cvxBeuiFileTree', className, classNames?.tree)}
      layoutRoot
      onMouseLeave={() => { setHoveredId(null) }}
    >
      {rows.map(row => {
          const isFolder = row.item.type === 'folder'
          const isOpen = isFolder && expanded.has(row.item.value)
          const isSelected = selectedId === row.item.value
          const isHovered = hoveredId === row.item.value
          return (
            <motion.div
              key={row.item.value}
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: row.item.disabled === true ? 0.42 : 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT }}
              className="cvxBeuiFileTreeRowShell"
            >
              <button
                ref={node => {
                  if (node === null) rowRefs.current.delete(row.item.value)
                  else rowRefs.current.set(row.item.value, node)
                }}
                type="button"
                role="treeitem"
                aria-level={row.depth + 1}
                aria-posinset={row.position}
                aria-setsize={row.setSize}
                aria-selected={isSelected}
                aria-expanded={isFolder ? isOpen : undefined}
                aria-disabled={row.item.disabled || undefined}
                draggable={row.item.type === 'file' && row.item.disabled !== true && row.item.draggable === true}
                tabIndex={focusedRow === row.item.value ? 0 : -1}
                className={classes('cvxBeuiFileTreeItem', isSelected && 'is-selected', classNames?.item, row.item.className)}
                style={{ paddingLeft: 8 + row.depth * indent }}
                onMouseEnter={() => { setHoveredId(row.item.value) }}
                onFocus={() => { setFocusedId(row.item.value) }}
                onDragStart={event => {
                  if (row.item.type !== 'file' || row.item.disabled === true || row.item.draggable !== true) {
                    event.preventDefault()
                    return
                  }
                  row.item.onDragStart?.(event)
                }}
                onKeyDown={event => { handleKeyDown(event, row) }}
                onClick={() => {
                  if (!itemEnabled(row.item)) return
                  selectItem(row.item)
                  if (isFolder) toggleFolder(row.item.value)
                }}
              >
                {isHovered && !isSelected && (
                  <motion.span
                    aria-hidden="true"
                    layoutId={`cvx-beui-tree-hover-${uid}`}
                    layoutDependency={hoveredId}
                    className="cvxBeuiFileTreeHover"
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                  />
                )}
                {isSelected && (
                  <motion.span
                    aria-hidden="true"
                    layoutId={`cvx-beui-tree-selection-${uid}`}
                    layoutDependency={selectedId}
                    className="cvxBeuiFileTreeSelection"
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                  />
                )}
                {row.depth > 0 && (
                  <motion.span
                    aria-hidden="true"
                    className="cvxBeuiFileTreeBranch"
                    style={{ left: 16 + (row.depth - 1) * indent }}
                    initial={reduce ? false : { opacity: 0, scaleY: 0 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.3, ease: EASE_OUT }}
                  />
                )}
                <motion.span
                  aria-hidden="true"
                  className={classes('cvxBeuiFileTreeChevron', !isFolder && 'is-empty')}
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={reduce ? { duration: 0 } : SPRING_SWAP}
                ><ChevronRight size={14} /></motion.span>
                <span aria-hidden="true" className={classes('cvxBeuiFileTreeIcon', classNames?.icon)}>
                  {renderIcon(row.item, isOpen, reduce)}
                </span>
                <span className={classes('cvxBeuiFileTreeLabel', classNames?.label)}>{row.item.name}</span>
              </button>
            </motion.div>
          )
      })}
    </motion.div>
  )
}

function itemEnabled(item: FileTreeItem): boolean { return item.disabled !== true }
