// Adapted from beUI Button under the MIT license.
// Source: https://beui.dev/components/motion/button
import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from 'motion/react'
import {
  forwardRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { EASE_OUT, SPRING_PRESS } from './motion.js'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly pressScale?: number
  readonly ripple?: boolean
  readonly children?: ReactNode
}

export interface ButtonLinkProps extends Omit<HTMLMotionProps<'a'>, 'children'> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly pressScale?: number
  readonly children?: ReactNode
}

type Ripple = { readonly id: number; readonly x: number; readonly y: number; readonly size: number }

function useHoverCapable(): boolean {
  const [capable, setCapable] = useState(() => typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia('(hover: hover)')
    const update = (): void => { setCapable(query.matches) }
    query.addEventListener('change', update)
    return () => { query.removeEventListener('change', update) }
  }, [])
  return capable
}

function classes(base: string, className: string | undefined): string {
  return className === undefined || className === '' ? base : `${base} ${className}`
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  pressScale = 0.96,
  ripple = false,
  className,
  children,
  onPointerDown,
  ...rest
}, ref) {
  const reduce = useReducedMotion() ?? false
  const canHover = useHoverCapable()
  const [ripples, setRipples] = useState<readonly Ripple[]>([])
  const nextId = useRef(0)

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (ripple && !reduce) {
      const rect = event.currentTarget.getBoundingClientRect()
      const sizeValue = Math.max(rect.width, rect.height) * 2
      const id = nextId.current++
      setRipples(previous => [...previous, {
        id,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        size: sizeValue,
      }])
    }
    onPointerDown?.(event)
  }, [onPointerDown, reduce, ripple])

  return (
    <motion.button
      ref={ref}
      type="button"
      {...(reduce ? {} : { whileTap: { scale: pressScale } })}
      {...(reduce || !canHover ? {} : { whileHover: { scale: 1.015 } })}
      transition={SPRING_PRESS}
      data-variant={variant}
      data-size={size}
      data-ripple={ripple || undefined}
      className={classes('cvxBeuiButton', className)}
      onPointerDown={handlePointerDown}
      {...rest}
    >
      {ripple && !reduce && (
        <span className="cvxBeuiRippleClip" aria-hidden="true">
          <AnimatePresence>
            {ripples.map(item => (
              <motion.span
                key={item.id}
                className="cvxBeuiRipple"
                style={{ left: item.x, top: item.y, width: item.size, height: item.size, x: '-50%', y: '-50%' }}
                initial={{ scale: 0.05, opacity: 0.25 }}
                animate={{ scale: 1, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.1, ease: EASE_OUT }}
                onAnimationComplete={() => { setRipples(previous => previous.filter(value => value.id !== item.id)) }}
              />
            ))}
          </AnimatePresence>
        </span>
      )}
      <span className="cvxBeuiButtonContent">{children}</span>
    </motion.button>
  )
})

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink({
  variant = 'primary',
  size = 'md',
  pressScale = 0.96,
  className,
  children,
  ...rest
}, ref) {
  const reduce = useReducedMotion() ?? false
  const canHover = useHoverCapable()
  return (
    <motion.a
      ref={ref}
      {...(reduce ? {} : { whileTap: { scale: pressScale } })}
      {...(reduce || !canHover ? {} : { whileHover: { scale: 1.015 } })}
      transition={SPRING_PRESS}
      data-variant={variant}
      data-size={size}
      className={classes('cvxBeuiButton', className)}
      {...rest}
    ><span className="cvxBeuiButtonContent">{children}</span></motion.a>
  )
})
