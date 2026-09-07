// Adapted from beUI's public MIT-licensed Chat App shell and responsive
// Animated Sidebar composition.
// Source: https://beui.dev/components/agents/chat-app
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react'
import { EASE_DRAWER } from './motion.js'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  "[tabindex]:not([tabindex='-1'])",
].join(',')

export interface ChatAppProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly children?: ReactNode
  /** Narrow-shell navigation rendered over the conversation without unmounting it. */
  readonly navigation?: ReactNode
  readonly navigationOpen?: boolean
  readonly navigationLabel?: string
  readonly navigationTriggerRef?: RefObject<HTMLElement>
  readonly onNavigationOpenChange?: (open: boolean) => void
}

function classes(base: string, className: string | undefined): string {
  return className === undefined || className === '' ? base : `${base} ${className}`
}

/**
 * BeUI Chat App shell adapted for a constrained workbench panel. The official
 * Chat App folds its navigation away when the shell cannot carry two panes;
 * this variant always uses that narrow-shell posture and keeps the inset child
 * mounted so streaming state, drafts, and scroll positions survive navigation.
 */
export function ChatApp({
  children,
  navigation,
  navigationOpen = false,
  navigationLabel = 'Chat navigation',
  navigationTriggerRef,
  onNavigationOpenChange,
  className,
  ...props
}: ChatAppProps) {
  const reduce = useReducedMotion() ?? false
  const insetRef = useRef<HTMLDivElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const previousOpen = useRef(navigationOpen)

  useEffect(() => {
    insetRef.current?.toggleAttribute('inert', navigationOpen)
    let frame: number | undefined
    if (navigationOpen) {
      frame = window.requestAnimationFrame(() => {
        const first = navigationRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        const target = first ?? navigationRef.current
        target?.focus({ preventScroll: true })
      })
    } else if (previousOpen.current) {
      navigationTriggerRef?.current?.focus({ preventScroll: true })
    }
    previousOpen.current = navigationOpen
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [navigationOpen, navigationTriggerRef])

  const close = (): void => { onNavigationOpenChange?.(false) }

  return (
    <section
      {...props}
      data-slot="chat-app"
      data-navigation-state={navigationOpen ? 'open' : 'closed'}
      className={classes('cvxBeuiChatApp', className)}
    >
      <div
        ref={insetRef}
        data-slot="chat-app-inset"
        className="cvxBeuiChatAppInset"
        aria-hidden={navigationOpen || undefined}
      >
        {children}
      </div>
      <AnimatePresence initial={false}>
        {navigationOpen && navigation !== undefined && (
          <motion.nav
            ref={navigationRef}
            key="chat-navigation"
            data-slot="chat-app-navigation"
            className="cvxBeuiChatAppNavigation"
            aria-label={navigationLabel}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -20 }}
            transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_DRAWER }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              close()
            }}
          >
            {navigation}
          </motion.nav>
        )}
      </AnimatePresence>
    </section>
  )
}
