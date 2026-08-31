// Adapted from beUI Tabs under the MIT license.
// Source: https://beui.dev/components/motion/tabs
import { motion, MotionConfig, useReducedMotion } from 'motion/react'
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
} from 'react'
import { EASE_OUT } from './motion.js'

export type TabsVariant = 'pill' | 'underline' | 'segment'
interface TabsContextValue {
  readonly value: string
  readonly setValue: (value: string) => void
  readonly layoutId: string
  readonly variant: TabsVariant
}
const TabsContext = createContext<TabsContextValue | null>(null)
const TAB_SPRING = { type: 'spring', stiffness: 240, damping: 28, mass: 0.8 } as const

function useTabs(): TabsContextValue {
  const context = useContext(TabsContext)
  if (context === null) throw new Error('Tabs components must be used inside <Tabs>')
  return context
}

export interface TabsProps {
  readonly defaultValue?: string | undefined
  readonly value?: string | undefined
  readonly onValueChange?: ((value: string) => void) | undefined
  readonly variant?: TabsVariant | undefined
  readonly children: ReactNode
  readonly className?: string | undefined
}

export function Tabs({ defaultValue = '', value, onValueChange, variant = 'pill', children, className }: TabsProps): ReactNode {
  const [internal, setInternal] = useState(defaultValue)
  const layoutId = useId()
  const reduce = useReducedMotion() ?? false
  const controlled = value !== undefined
  const current = controlled ? value : internal
  const setValue = useCallback((next: string) => {
    if (!controlled) setInternal(next)
    onValueChange?.(next)
  }, [controlled, onValueChange])
  const context = useMemo(() => ({ value: current, setValue, layoutId, variant }), [current, layoutId, setValue, variant])
  return (
    <MotionConfig transition={reduce ? { duration: 0 } : TAB_SPRING}>
      <TabsContext.Provider value={context}>
        <motion.div layoutRoot className={className === undefined ? 'cvxBeuiTabs' : `cvxBeuiTabs ${className}`}>
          {children}
        </motion.div>
      </TabsContext.Provider>
    </MotionConfig>
  )
}

export function TabsList({ children, className, ariaLabel }: {
  readonly children: ReactNode
  readonly className?: string | undefined
  readonly ariaLabel?: string | undefined
}): ReactNode {
  const { variant } = useTabs()
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
    if (tabs.length === 0) return
    const active = tabs.indexOf(document.activeElement as HTMLButtonElement)
    let next = active < 0 ? 0 : active
    if (event.key === 'ArrowRight') next = (next + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (next - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else next = tabs.length - 1
    event.preventDefault()
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  return (
    <div
      role="tablist"
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      data-variant={variant}
      className={className === undefined ? 'cvxBeuiTabsList' : `cvxBeuiTabsList ${className}`}
      onKeyDown={handleKeyDown}
    >{children}</div>
  )
}

export function TabsTrigger({ value, children, className }: {
  readonly value: string
  readonly children: ReactNode
  readonly className?: string | undefined
}): ReactNode {
  const { value: current, setValue, layoutId, variant } = useTabs()
  const active = current === value
  return (
    <div className="cvxBeuiTabsTriggerShell">
      {active && <motion.span layoutId={layoutId} layout="position" data-variant={variant} className="cvxBeuiTabsIndicator" />}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className={className === undefined ? 'cvxBeuiTabsTrigger' : `cvxBeuiTabsTrigger ${className}`}
        onClick={() => { setValue(value) }}
      >{children}</button>
    </div>
  )
}

export function TabsContent({ value, children, className }: {
  readonly value: string
  readonly children: ReactNode
  readonly className?: string | undefined
}): ReactNode {
  const { value: current } = useTabs()
  const reduce = useReducedMotion() ?? false
  if (current !== value) return <div role="tabpanel" hidden className={className}>{children}</div>
  return (
    <motion.div
      role="tabpanel"
      initial={{ opacity: 0, y: reduce ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
      className={className}
    >{children}</motion.div>
  )
}
