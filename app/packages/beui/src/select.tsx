// Adapted from the BeUI Select component under the MIT license.
// Source: https://beui.dev/components/motion/select
import { Check, ChevronDown } from 'lucide-react'
import {
  motion,
  type Transition,
  useReducedMotion,
  type Variants,
} from 'motion/react'
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { EASE_OUT } from './motion.js'

const INSTANT_TRANSITION: Transition = { duration: 0 }
const CHEVRON_TRANSITION: Transition = { type: 'spring', duration: 0.4, bounce: 0.3 }
const LIST_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
}
const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -6, filter: 'blur(3px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)' },
}

type Placement = 'bottom' | 'top'

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export interface SelectProps {
  readonly value: string | undefined
  readonly options: readonly SelectOption[]
  readonly onValueChange: (value: string) => void
  readonly ariaLabel: string
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly className?: string
}

export function Select({
  value,
  options,
  onValueChange,
  ariaLabel,
  placeholder = 'Select…',
  disabled = false,
  className,
}: SelectProps): ReactElement {
  const reduce = useReducedMotion() ?? false
  const listboxId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const keyboardOpen = useRef(false)
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)
  const [height, setHeight] = useState(0)
  const [placement, setPlacement] = useState<Placement>('bottom')
  const selected = value === undefined ? undefined : options.find(option => option.value === value)

  useLayoutEffect(() => {
    const node = inner.current
    if (node === null) return
    const measure = (): void => { setHeight(node.offsetHeight) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [options])

  useLayoutEffect(() => {
    menu.current?.toggleAttribute('inert', !open)
  }, [open])

  useLayoutEffect(() => {
    if (!open || trigger.current === null || inner.current === null) return
    const rect = trigger.current.getBoundingClientRect()
    const contentHeight = inner.current.offsetHeight
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    setPlacement(below < contentHeight + 16 && above > below ? 'top' : 'bottom')
  }, [open, options])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        trigger.current?.focus()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const target = selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled)
    const next = target >= 0 ? target : 0
    setActiveIndex(next)
    if (keyboardOpen.current) optionRefs.current[next]?.focus()
    keyboardOpen.current = false
  }, [open, options, selectedIndex])

  const enabledIndexes = options.flatMap((option, index) => option.disabled ? [] : [index])
  const focusIndex = (index: number): void => {
    setActiveIndex(index)
    optionRefs.current[index]?.focus()
  }
  const move = (direction: 1 | -1): void => {
    if (enabledIndexes.length === 0) return
    const current = enabledIndexes.indexOf(activeIndex)
    const fallback = direction === 1 ? -1 : 0
    const next = (current < 0 ? fallback : current) + direction
    focusIndex(enabledIndexes[(next + enabledIndexes.length) % enabledIndexes.length] ?? enabledIndexes[0] ?? 0)
  }
  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }
  const choose = (option: SelectOption): void => {
    if (option.disabled) return
    onValueChange(option.value)
    close()
  }
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    keyboardOpen.current = true
    setOpen(true)
  }
  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
    } else if (event.key === 'Home' && enabledIndexes[0] !== undefined) {
      event.preventDefault()
      focusIndex(enabledIndexes[0])
    } else if (event.key === 'End' && enabledIndexes.at(-1) !== undefined) {
      event.preventDefault()
      focusIndex(enabledIndexes.at(-1) ?? 0)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const isTop = placement === 'top'
  const triggerRadius = open ? [0, 0, 12] : [12, 0, 12]
  const triggerRadiusTransition: Transition = reduce
    ? { duration: 0 }
    : open
      ? { duration: 0.6, times: [0, 0.4, 1], ease: EASE_OUT }
      : { duration: 0.42, times: [0, 0.5, 1], ease: EASE_OUT }
  const nearGap = open ? 8 : 0
  const nearRadius = open ? 12 : 0
  const gapTransition: Transition = open
    ? { type: 'spring', duration: 0.6, bounce: 0.5, delay: 0.12 }
    : { type: 'spring', duration: 0.3, bounce: 0.1 }
  const radiusTransition: Transition = open
    ? { duration: 0.3, ease: EASE_OUT, delay: 0.14 }
    : { duration: 0.16, ease: EASE_OUT }

  return (
    <div ref={root} className={className === undefined ? 'cvxBeuiSelect' : `cvxBeuiSelect ${className}`}>
      <motion.button
        ref={trigger}
        type="button"
        className="cvxBeuiSelectTrigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        initial={false}
        animate={{
          borderTopLeftRadius: isTop ? triggerRadius : 12,
          borderTopRightRadius: isTop ? triggerRadius : 12,
          borderBottomLeftRadius: isTop ? 12 : triggerRadius,
          borderBottomRightRadius: isTop ? 12 : triggerRadius,
        }}
        transition={{
          borderTopLeftRadius: isTop ? triggerRadiusTransition : INSTANT_TRANSITION,
          borderTopRightRadius: isTop ? triggerRadiusTransition : INSTANT_TRANSITION,
          borderBottomLeftRadius: isTop ? INSTANT_TRANSITION : triggerRadiusTransition,
          borderBottomRightRadius: isTop ? INSTANT_TRANSITION : triggerRadiusTransition,
        }}
        onClick={() => {
          keyboardOpen.current = false
          setOpen(previous => !previous)
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="cvxBeuiSelectValue" data-placeholder={selected === undefined || undefined}>{selected?.label ?? placeholder}</span>
        <motion.span
          aria-hidden="true"
          className="cvxBeuiSelectChevron"
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : CHEVRON_TRANSITION}
        >
          <ChevronDown size={16} strokeWidth={1.6} />
        </motion.span>
      </motion.button>
      <motion.div
        ref={menu}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
        aria-hidden={!open}
        className="cvxBeuiSelectMenu"
        data-placement={placement}
        initial={false}
        animate={reduce
          ? { opacity: open ? 1 : 0, height: open ? height : 0 }
          : {
              opacity: open ? 1 : 0,
              height: open ? height : 0,
              marginTop: isTop ? 0 : nearGap,
              marginBottom: isTop ? nearGap : 0,
              borderTopLeftRadius: isTop ? 12 : nearRadius,
              borderTopRightRadius: isTop ? 12 : nearRadius,
              borderBottomLeftRadius: isTop ? nearRadius : 12,
              borderBottomRightRadius: isTop ? nearRadius : 12,
            }}
        transition={reduce
          ? { duration: 0.12 }
          : {
              opacity: open ? { duration: 0.18 } : { duration: 0.16, delay: 0.12 },
              height: open
                ? { type: 'spring', duration: 0.42, bounce: 0.14 }
                : { duration: 0.26, ease: EASE_OUT, delay: 0.14 },
              marginTop: isTop ? INSTANT_TRANSITION : gapTransition,
              marginBottom: isTop ? gapTransition : INSTANT_TRANSITION,
              borderTopLeftRadius: isTop ? INSTANT_TRANSITION : radiusTransition,
              borderTopRightRadius: isTop ? INSTANT_TRANSITION : radiusTransition,
              borderBottomLeftRadius: isTop ? radiusTransition : INSTANT_TRANSITION,
              borderBottomRightRadius: isTop ? radiusTransition : INSTANT_TRANSITION,
            }}
        style={{
          transformOrigin: isTop ? 'bottom' : 'top',
          overflow: 'hidden',
          pointerEvents: open ? 'auto' : 'none',
        }}
        onKeyDown={handleListKeyDown}
      >
        <motion.div
          ref={inner}
          className="cvxBeuiSelectList"
          {...(reduce ? {} : { variants: LIST_VARIANTS })}
          initial={false}
          animate={open ? 'show' : 'hidden'}
        >
          {options.length === 0
            ? <div className="cvxBeuiSelectEmpty">No options</div>
            : options.map((option, index) => {
                const isSelected = option.value === value
                return (
                  <motion.div key={option.value} className="cvxBeuiSelectItem" {...(reduce ? {} : { variants: ITEM_VARIANTS })}>
                    <button
                      ref={(element) => { optionRefs.current[index] = element }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      disabled={option.disabled}
                      tabIndex={open && index === activeIndex ? 0 : -1}
                      className="cvxBeuiSelectOption"
                      data-active={index === activeIndex || undefined}
                      onPointerMove={() => { if (!option.disabled) setActiveIndex(index) }}
                      onClick={() => { choose(option) }}
                    >
                      <span className="cvxBeuiSelectOptionLabel">{option.label}</span>
                      {isSelected && <Check className="cvxBeuiSelectCheck" size={14} strokeWidth={1.8} />}
                    </button>
                  </motion.div>
                )
              })}
        </motion.div>
      </motion.div>
    </div>
  )
}
