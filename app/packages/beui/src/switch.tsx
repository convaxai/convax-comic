// Adapted from beUI Switch under the MIT license.
// Source: https://beui.dev/components/motion/switch
import { animate, motion, MotionConfig, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

const THUMB_SPRING = { type: 'spring', stiffness: 800, damping: 80, mass: 4 } as const

export interface SwitchProps {
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly disabled?: boolean | undefined
  readonly label?: ReactNode | undefined
  readonly ariaLabel?: string | undefined
  readonly className?: string | undefined
}

export function Switch({ checked, onCheckedChange, disabled, label, ariaLabel, className }: SwitchProps): ReactNode {
  const id = useId()
  const thumbRef = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion() ?? false
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    if (thumbRef.current === null || reduce || !disabled || !pressed) return
    animate(thumbRef.current, { x: [0, -2, 2, -1, 0] }, { delay: 0.1, duration: 0.45 })
  }, [disabled, pressed, reduce])

  const squish = !disabled && pressed && !reduce
  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={className === undefined ? 'cvxBeuiSwitchRoot' : `cvxBeuiSwitchRoot ${className}`}>
        <motion.button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
          disabled={disabled}
          data-state={checked ? 'checked' : 'unchecked'}
          className="cvxBeuiSwitch"
          onClick={() => { if (!disabled) onCheckedChange(!checked) }}
          onPointerDown={() => { setPressed(true) }}
          onPointerUp={() => { setPressed(false) }}
          onPointerCancel={() => { setPressed(false) }}
          onPointerLeave={() => { setPressed(false) }}
        >
          <motion.span
            ref={thumbRef}
            layout
            animate={{ scaleX: squish ? 1.12 : 1, scaleY: squish ? 0.88 : 1 }}
            className="cvxBeuiSwitchThumb"
          />
        </motion.button>
        {label !== undefined && <label htmlFor={id} className="cvxBeuiSwitchLabel">{label}</label>}
      </span>
    </MotionConfig>
  )
}
