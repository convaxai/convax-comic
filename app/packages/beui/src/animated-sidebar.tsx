// Adapted from beUI's public MIT-licensed Animated Sidebar surface and menu item.
// Source: https://beui.dev/components/motion/animated-sidebar
import { ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps, type Variants } from 'motion/react'
import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { EASE_OUT, SPRING_LAYOUT } from './motion.js'

type AnimatedSidebarStyle = CSSProperties & {
  '--cvx-beui-animated-sidebar-width'?: string
}

// Source parity: beUI removes a closing submenu from layout with popLayout and
// reveals its paint with clip-path instead of springing an intrinsic height.
const SUBMENU_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    clipPath: 'inset(0 0 100% 0 round 8px)',
    transition: {
      duration: 0.14,
      ease: EASE_OUT,
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
  open: {
    opacity: 1,
    clipPath: 'inset(0 0 0% 0 round 8px)',
    transition: {
      duration: 0.2,
      delayChildren: 0.035,
      ease: EASE_OUT,
      staggerChildren: 0.045,
    },
  },
}

export interface AnimatedSidebarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  readonly collapsed: boolean
  readonly width: number
  readonly children?: ReactNode
}

/**
 * Animated surface for an application sidebar whose geometry is owned by a
 * surrounding layout. Paint-only CSS transitions preserve the caller's width
 * contract and are disabled by the shared reduced-motion media query.
 */
export const AnimatedSidebar = forwardRef<HTMLElement, AnimatedSidebarProps>(function AnimatedSidebar({
  collapsed,
  width,
  className,
  style,
  children,
  ...props
}, ref) {
  const resolvedWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0
  const mergedStyle = {
    ...style,
    '--cvx-beui-animated-sidebar-width': `${resolvedWidth}px`,
  } as AnimatedSidebarStyle

  return (
    <aside
      {...props}
      ref={ref}
      data-slot="animated-sidebar"
      data-state={collapsed ? 'collapsed' : 'expanded'}
      data-width={resolvedWidth}
      style={mergedStyle}
      className={className === undefined ? 'cvxBeuiAnimatedSidebar' : `cvxBeuiAnimatedSidebar ${className}`}
    >
      <div aria-hidden="true" className="cvxBeuiAnimatedSidebarBackdrop">
        <span className="cvxBeuiAnimatedSidebarGlow" />
      </div>
      <div className="cvxBeuiAnimatedSidebarContent">{children}</div>
    </aside>
  )
})

export interface AnimatedSidebarSubmenuProps extends Omit<HTMLMotionProps<'div'>, 'animate' | 'children' | 'exit' | 'initial' | 'transition' | 'variants'> {
  readonly expanded: boolean
  readonly children?: ReactNode
}

/** beUI-style nested region: popLayout prevents an exiting submenu from reserving space. */
export const AnimatedSidebarSubmenu = forwardRef<HTMLDivElement, AnimatedSidebarSubmenuProps>(function AnimatedSidebarSubmenu({
  expanded,
  className,
  children,
  ...props
}, ref) {
  const reduce = useReducedMotion() ?? false
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {expanded ? (
        <motion.div
          {...props}
          ref={ref}
          key="animated-sidebar-submenu"
          {...(reduce ? { transition: { duration: 0.12 } } : { variants: SUBMENU_VARIANTS })}
          initial={reduce ? false : 'closed'}
          animate={reduce ? { opacity: 1 } : 'open'}
          exit={reduce ? { opacity: 0 } : 'closed'}
          className={className === undefined ? 'cvxBeuiAnimatedSidebarSubmenu' : `cvxBeuiAnimatedSidebarSubmenu ${className}`}
          data-expanded="true"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
})

export interface AnimatedSidebarMenuItemProps extends Omit<HTMLMotionProps<'div'>, 'children' | 'layout' | 'transition'> {
  readonly label: ReactNode
  readonly icon?: ReactNode
  readonly variant?: 'item' | 'section'
  readonly expanded: boolean
  readonly meta?: ReactNode
  readonly actions?: ReactNode
  readonly buttonClassName?: string
  readonly onToggle: () => void
}

/** First-level Animated Sidebar item with a fixed icon/label/trailing grid. */
export const AnimatedSidebarMenuItem = forwardRef<HTMLDivElement, AnimatedSidebarMenuItemProps>(function AnimatedSidebarMenuItem({
  label,
  icon,
  variant = 'item',
  expanded,
  meta,
  actions,
  className,
  buttonClassName,
  onToggle,
  ...props
}, ref) {
  const reduce = useReducedMotion() ?? false
  return (
    <motion.div
      {...props}
      ref={ref}
      layout={reduce ? false : 'position'}
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      className={className === undefined ? 'cvxBeuiAnimatedSidebarMenuItem' : `cvxBeuiAnimatedSidebarMenuItem ${className}`}
      data-variant={variant}
      data-expanded={expanded || undefined}
      data-has-actions={actions === undefined ? undefined : true}
    >
      <button
        type="button"
        className={buttonClassName === undefined ? 'cvxBeuiAnimatedSidebarMenuButton' : `cvxBeuiAnimatedSidebarMenuButton ${buttonClassName}`}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {icon !== undefined && <span aria-hidden="true" className="cvxBeuiAnimatedSidebarMenuIcon">{icon}</span>}
        <span className="cvxBeuiAnimatedSidebarMenuLabel">{label}</span>
        {meta !== undefined && <small className="cvxBeuiAnimatedSidebarMenuMeta">{meta}</small>}
        <span aria-hidden="true" className="cvxBeuiAnimatedSidebarMenuChevron"><ChevronRight size={16} /></span>
      </button>
      {actions !== undefined && <div className="cvxBeuiAnimatedSidebarMenuActions">{actions}</div>}
    </motion.div>
  )
})
