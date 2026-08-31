// Adapted from beUI Input under the MIT license.
// Source: https://beui.dev/components/motion/input
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> {
  readonly label?: string | undefined
  readonly value?: string | undefined
  readonly defaultValue?: string | undefined
  readonly onChange?: ((value: string) => void) | undefined
  readonly error?: string | boolean | undefined
  readonly reserveErrorLine?: boolean | undefined
  readonly success?: boolean | undefined
  readonly leftIcon?: ReactNode | undefined
  readonly rightIcon?: ReactNode | undefined
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({
  label,
  value: valueProp,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  error,
  reserveErrorLine = false,
  success,
  leftIcon,
  rightIcon,
  className,
  disabled,
  id: idProp,
  ...rest
}, ref) {
  const generatedId = useId()
  const id = idProp ?? generatedId
  const reduce = useReducedMotion() ?? false
  const controlled = valueProp !== undefined
  const [internal, setInternal] = useState(defaultValue ?? '')
  const [focused, setFocused] = useState(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const value = controlled ? valueProp : internal
  const hasError = Boolean(error)
  const errorMessage = typeof error === 'string' ? error : null

  useEffect(() => {
    if (fieldRef.current === null || reduce || !hasError) return
    animate(fieldRef.current, { x: [0, -6, 6, -4, 4, -2, 0] }, { duration: 0.42 })
  }, [hasError, reduce])

  return (
    <div className={className === undefined ? 'cvxBeuiInputRoot' : `cvxBeuiInputRoot ${className}`}>
      {label !== undefined && <label htmlFor={id} className="cvxBeuiInputLabel">{label}</label>}
      <div
        ref={fieldRef}
        data-state={hasError ? 'error' : success ? 'success' : focused ? 'focused' : 'idle'}
        data-disabled={disabled || undefined}
        className="cvxBeuiInputField"
      >
        {leftIcon !== undefined && <span className="cvxBeuiInputLeft" aria-hidden="true">{leftIcon}</span>}
        <input
          {...rest}
          ref={ref}
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          {...(errorMessage === null ? {} : { 'aria-describedby': `${id}-error` })}
          className="cvxBeuiInput"
          data-left-icon={leftIcon !== undefined || undefined}
          data-right-icon={(rightIcon !== undefined || success === true) || undefined}
          onChange={event => {
            const next = event.currentTarget.value
            if (!controlled) setInternal(next)
            onChange?.(next)
          }}
          onFocus={event => { setFocused(true); onFocus?.(event) }}
          onBlur={event => { setFocused(false); onBlur?.(event) }}
        />
        {success ? (
          <motion.svg viewBox="0 0 24 24" fill="none" className="cvxBeuiInputSuccess" aria-hidden="true">
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: reduce ? 0 : 0.35 }}
            />
          </motion.svg>
        ) : rightIcon !== undefined ? <span className="cvxBeuiInputRight">{rightIcon}</span> : null}
      </div>
      <div className={reserveErrorLine ? 'cvxBeuiInputMessage is-reserved' : 'cvxBeuiInputMessage'}>
        <AnimatePresence initial={false}>
          {errorMessage !== null && (
            <motion.p
              id={`${id}-error`}
              role="alert"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
              className="cvxBeuiInputError"
            >{errorMessage}</motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})
