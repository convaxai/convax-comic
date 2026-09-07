// Visual motion adapted from beUI Prompt Input under the MIT license.
// Source: https://beui.dev/components/agents/prompt-input

const ADD_BUTTON_SELECTOR = 'button[aria-haspopup="listbox"]'
const SEND_LABELS = new Set(['Send message', 'Stop generating', '发送消息', '停止生成'])
const WORKSPACE_SWITCH_SELECTOR = 'button[aria-label="选择工作区"], button[aria-label="Choose workspace"]'
const INPUT_RIGHT_SELECTOR = '[data-slot="conversation.input.right"]'
const QUOTA_SELECTOR = '[data-openai-codex-quota]'
const QUOTA_TRACK_SELECTOR = '[data-openai-codex-quota-track]'
const QUOTA_PROGRESS_SELECTOR = '[data-openai-codex-quota-progress]'
const HERO_HEADLINES = new Map([
  ['探索未至之境', '实现你的任何想法'],
  ['Into the Unknown', 'Bring any idea to life'],
])

export function projectAgentHeadline(value: string): string {
  return HERO_HEADLINES.get(value.trim()) ?? value
}

interface InlineBounds {
  readonly left: number
  readonly right: number
}

export function projectInlinePopupShift(container: InlineBounds, popup: InlineBounds, inset = 8): number {
  const safeLeft = container.left + inset
  const safeRight = container.right - inset
  let shift = popup.left < safeLeft ? safeLeft - popup.left : 0
  if (popup.right + shift > safeRight) shift += safeRight - (popup.right + shift)
  return Math.round(shift)
}

export const BEUI_PROMPT_ADD_OPEN_KEYFRAMES = Object.freeze([
  Object.freeze({ offset: 0, transform: 'rotate(0deg) scale(1)' }),
  Object.freeze({ offset: 0.58, transform: 'rotate(52deg) scale(1.04)' }),
  Object.freeze({ offset: 0.82, transform: 'rotate(42deg) scale(1)' }),
  Object.freeze({ offset: 1, transform: 'rotate(45deg) scale(1)' }),
])

export const BEUI_PROMPT_ADD_CLOSED_KEYFRAMES = Object.freeze([
  Object.freeze({ offset: 0, transform: 'rotate(45deg) scale(1)' }),
  Object.freeze({ offset: 0.58, transform: 'rotate(-7deg) scale(1.04)' }),
  Object.freeze({ offset: 0.82, transform: 'rotate(3deg) scale(1)' }),
  Object.freeze({ offset: 1, transform: 'rotate(0deg) scale(1)' }),
])

export const BEUI_PROMPT_SWAP_KEYFRAMES = Object.freeze([
  Object.freeze({ offset: 0, opacity: 0, transform: 'translateY(3px) scale(.8)' }),
  Object.freeze({ offset: 0.68, opacity: 1, transform: 'translateY(-1px) scale(1.04)' }),
  Object.freeze({ offset: 1, opacity: 1, transform: 'translateY(0) scale(1)' }),
])

export const BEUI_PROMPT_MENU_KEYFRAMES = Object.freeze([
  Object.freeze({ offset: 0, opacity: 0, transform: 'translateY(6px) scale(.96)', clipPath: 'inset(92% 92% 0 0 round 12px)' }),
  Object.freeze({ offset: 0.72, opacity: 1, transform: 'translateY(-1px) scale(1.005)', clipPath: 'inset(0 0 0 0 round 12px)' }),
  Object.freeze({ offset: 1, opacity: 1, transform: 'translateY(0) scale(1)', clipPath: 'inset(0 0 0 0 round 12px)' }),
])

const ADD_DURATION = 360
const SWAP_DURATION = 280
const SWAP_EASING = 'cubic-bezier(.16, 1, .3, 1)'

type Cleanup = () => void

function commandButton(card: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(card.querySelectorAll<HTMLButtonElement>(ADD_BUTTON_SELECTOR))
    .find(button => button.closest('[data-slot="conversation.input.model"]') === null)
}

function sendButton(card: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-label]'))
    .find(button => SEND_LABELS.has(button.getAttribute('aria-label') ?? ''))
}

function addClass(element: Element | null | undefined, className: string): void {
  element?.classList.add(className)
}

function removeClass(element: Element | null | undefined, className: string): void {
  element?.classList.remove(className)
}

function mark(element: Element | null | undefined, name: string): void {
  element?.setAttribute(name, '')
}

function unmark(element: Element | null | undefined, name: string): void {
  element?.removeAttribute(name)
}

function animateIcon(
  icon: SVGElement,
  keyframes: readonly Readonly<Keyframe>[],
  duration: number,
  easing = SWAP_EASING,
): void {
  icon.getAnimations().forEach(animation => { animation.cancel() })
  icon.animate(keyframes.map(frame => ({ ...frame })), { duration, easing, fill: 'forwards' })
}

function decoratePromptMenu(menu: HTMLElement, reduce: MediaQueryList): Cleanup {
  const markContents = (): void => {
    for (const group of menu.querySelectorAll('[role="presentation"]')) mark(group, 'data-beui-prompt-menu-label')
    for (const option of menu.querySelectorAll('[role="option"]')) mark(option, 'data-beui-prompt-menu-option')
  }
  mark(menu, 'data-beui-prompt-menu')
  markContents()
  if (!reduce.matches) {
    menu.animate(BEUI_PROMPT_MENU_KEYFRAMES.map(frame => ({ ...frame })), {
      duration: 240,
      easing: SWAP_EASING,
    })
  }
  const observer = new MutationObserver(markContents)
  observer.observe(menu, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    menu.getAnimations().forEach(animation => { animation.cancel() })
    unmark(menu, 'data-beui-prompt-menu')
    for (const group of menu.querySelectorAll('[data-beui-prompt-menu-label]')) unmark(group, 'data-beui-prompt-menu-label')
    for (const option of menu.querySelectorAll('[data-beui-prompt-menu-option]')) unmark(option, 'data-beui-prompt-menu-option')
  }
}

function decoratePromptCard(card: HTMLElement, reduce: MediaQueryList): Cleanup {
  const root = card.parentElement
  const add = commandButton(card)
  const send = sendButton(card)
  const addIcon = add?.querySelector<SVGElement>('svg') ?? undefined
  const sendIconHost = send
  const row = add?.parentElement?.parentElement
  const tools = add?.parentElement
  const trailing = send?.parentElement
  const scroll = card.querySelector('[data-input-scroll]')
  const textarea = card.querySelector('textarea')
  const backdrop = card.querySelector('[data-input-backdrop]')
  const mirror = card.querySelector('[data-input-mirror]')
  let model = card.querySelector('[data-slot="conversation.input.model"] button')

  addClass(root, 'cvxBeuiPromptInputRoot')
  addClass(card, 'cvxBeuiPromptInput')
  addClass(scroll, 'cvxBeuiPromptInputScroll')
  addClass(textarea, 'cvxBeuiPromptInputText')
  addClass(backdrop, 'cvxBeuiPromptInputBackdrop')
  addClass(mirror, 'cvxBeuiPromptInputMirror')
  addClass(row, 'cvxBeuiPromptInputRow')
  addClass(tools, 'cvxBeuiPromptInputTools')
  addClass(trailing, 'cvxBeuiPromptInputTrailing')
  addClass(add, 'cvxBeuiPromptInputAdd')
  addClass(addIcon, 'cvxBeuiPromptInputAddIcon')
  addClass(model, 'cvxBeuiPromptInputModel')
  addClass(send, 'cvxBeuiPromptInputSend')
  mark(root, 'data-beui-prompt-root')
  mark(card, 'data-beui-prompt-input')
  mark(scroll, 'data-beui-prompt-scroll')
  mark(textarea, 'data-beui-prompt-text')
  mark(backdrop, 'data-beui-prompt-backdrop')
  mark(mirror, 'data-beui-prompt-mirror')
  mark(row, 'data-beui-prompt-row')
  mark(tools, 'data-beui-prompt-tools')
  mark(trailing, 'data-beui-prompt-trailing')
  mark(add, 'data-beui-prompt-add')
  mark(addIcon, 'data-beui-prompt-add-icon')
  mark(model, 'data-beui-prompt-model')
  mark(send, 'data-beui-prompt-send')

  let addOpen = add?.getAttribute('aria-expanded') === 'true'
  if (add !== undefined) add.dataset.beuiState = addOpen ? 'open' : 'closed'
  if (addIcon !== undefined) addIcon.style.transform = addOpen ? 'rotate(45deg)' : 'rotate(0deg)'

  const addObserver = add === undefined || addIcon === undefined ? undefined : new MutationObserver(() => {
    const nextOpen = add.getAttribute('aria-expanded') === 'true'
    if (nextOpen === addOpen) return
    addOpen = nextOpen
    add.dataset.beuiState = addOpen ? 'open' : 'closed'
    if (reduce.matches) {
      addIcon.getAnimations().forEach(animation => { animation.cancel() })
      addIcon.style.transform = addOpen ? 'rotate(45deg)' : 'rotate(0deg)'
      return
    }
    animateIcon(addIcon, addOpen ? BEUI_PROMPT_ADD_OPEN_KEYFRAMES : BEUI_PROMPT_ADD_CLOSED_KEYFRAMES, ADD_DURATION, 'linear')
  })
  addObserver?.observe(add as HTMLButtonElement, { attributes: true, attributeFilter: ['aria-expanded'] })

  let sendIcon = send?.querySelector<SVGElement>('svg') ?? undefined
  const sendObserver = sendIconHost === undefined ? undefined : new MutationObserver(() => {
    const nextIcon = sendIconHost.querySelector<SVGElement>('svg')
    if (nextIcon === null || nextIcon === sendIcon) return
    sendIcon = nextIcon
    addClass(nextIcon, 'cvxBeuiPromptInputSendIcon')
    mark(nextIcon, 'data-beui-prompt-send-icon')
    if (!reduce.matches) animateIcon(nextIcon, BEUI_PROMPT_SWAP_KEYFRAMES, SWAP_DURATION)
  })
  addClass(sendIcon, 'cvxBeuiPromptInputSendIcon')
  mark(sendIcon, 'data-beui-prompt-send-icon')
  sendObserver?.observe(sendIconHost as HTMLButtonElement, { childList: true, subtree: true })

  const menus = new Map<HTMLElement, Cleanup>()
  const scanMenus = (): void => {
    for (const [menu, cleanup] of menus) {
      if (card.contains(menu)) continue
      cleanup()
      menus.delete(menu)
    }
    for (const menu of card.querySelectorAll<HTMLElement>('[data-slot="conversation.input.overlay"] [role="listbox"]')) {
      if (menus.has(menu)) continue
      menus.set(menu, decoratePromptMenu(menu, reduce))
    }
  }
  let disposed = false
  let modelMenu: HTMLElement | undefined
  let modelMenuFrame: number | undefined
  let quotaSlot: HTMLElement | undefined
  let quotaSnapshot: { readonly right: number; readonly top: number } | undefined
  let quotaTargets = new Map<HTMLElement, number>()
  let quotaTransitionActive = false
  const alignModelMenu = (): void => {
    modelMenuFrame = undefined
    if (disposed || modelMenu === undefined || !card.contains(modelMenu)) return
    modelMenu.style.setProperty('--cvx-beui-model-menu-shift', '0px')
    const bounds = card.getBoundingClientRect()
    const menuBounds = modelMenu.getBoundingClientRect()
    const shift = projectInlinePopupShift(bounds, menuBounds)
    modelMenu.style.setProperty('--cvx-beui-model-menu-shift', `${shift}px`)
  }
  const scheduleModelMenuAlignment = (): void => {
    if (disposed || modelMenu === undefined || modelMenuFrame !== undefined) return
    modelMenuFrame = window.requestAnimationFrame(alignModelMenu)
  }
  const modelMenuResizeObserver = new ResizeObserver(scheduleModelMenuAlignment)
  modelMenuResizeObserver.observe(card)

  const clearQuotaCompensation = (): void => {
    for (const target of quotaTargets.keys()) {
      unmark(target, 'data-beui-quota-compensate')
      target.style.removeProperty('--cvx-beui-quota-item-shift')
    }
  }
  const renderedTrailingItems = (trailingElement: HTMLElement): HTMLElement[] => {
    const items: HTMLElement[] = []
    for (const child of Array.from(trailingElement.children)) {
      const candidates = window.getComputedStyle(child).display === 'contents' ? Array.from(child.children) : [child]
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLElement) || candidate.getBoundingClientRect().width === 0) continue
        items.push(candidate)
      }
    }
    return items
  }
  const showQuotaPlaceholder = (): void => {
    const trailingElement = trailing as HTMLElement | undefined
    if (quotaSnapshot === undefined || trailingElement === undefined) return
    const trailingBounds = trailingElement.getBoundingClientRect()
    trailingElement.style.setProperty('--cvx-beui-quota-right', `${Math.round(quotaSnapshot.right)}px`)
    trailingElement.style.setProperty('--cvx-beui-quota-top', `${Math.round(quotaSnapshot.top)}px`)
    mark(trailingElement, 'data-beui-quota-placeholder')
    for (const [target, targetRight] of quotaTargets) {
      if (!trailingElement.contains(target)) continue
      target.style.setProperty('--cvx-beui-quota-item-shift', '0px')
      mark(target, 'data-beui-quota-compensate')
      const targetBounds = target.getBoundingClientRect()
      const desiredLeft = trailingBounds.right - targetRight - targetBounds.width
      target.style.setProperty('--cvx-beui-quota-item-shift', `${Math.round(desiredLeft - targetBounds.left)}px`)
    }
  }

  const syncQuotaPlaceholder = (): void => {
    quotaSlot = card.querySelector<HTMLElement>(INPUT_RIGHT_SELECTOR) ?? undefined
    const quota = quotaSlot?.querySelector<HTMLElement>(QUOTA_SELECTOR) ?? undefined
    const trailingElement = trailing as HTMLElement | undefined
    const modelOpen = model?.getAttribute('aria-expanded') === 'true'
    if (quota !== undefined && trailingElement !== undefined) {
      if (!modelOpen) quotaTransitionActive = false
      clearQuotaCompensation()
      const trailingBounds = trailingElement.getBoundingClientRect()
      const quotaBounds = quota.getBoundingClientRect()
      quotaSnapshot = {
        right: trailingBounds.right - quotaBounds.right,
        top: quotaBounds.top - trailingBounds.top + (quotaBounds.height - 6) / 2,
      }
      quotaTargets = new Map(renderedTrailingItems(trailingElement)
        .filter(target => target !== quota)
        .map(target => [target, trailingBounds.right - target.getBoundingClientRect().right] as const))
      const track = quota.querySelector<HTMLElement>(QUOTA_TRACK_SELECTOR)
      const progress = quota.querySelector<HTMLElement>(QUOTA_PROGRESS_SELECTOR)
      const progressWidth = progress?.style.width.trim()
      if (progressWidth !== undefined && progressWidth !== '') trailingElement.style.setProperty('--cvx-beui-quota-progress', progressWidth)
      const trackColor = track?.style.backgroundColor.trim()
      if (trackColor !== undefined && trackColor !== '') trailingElement.style.setProperty('--cvx-beui-quota-track', trackColor)
      const progressColor = progress?.style.backgroundColor.trim()
      if (progressColor !== undefined && progressColor !== '') trailingElement.style.setProperty('--cvx-beui-quota-color', progressColor)
    }
    if (quota === undefined && quotaTransitionActive) {
      showQuotaPlaceholder()
    } else {
      unmark(trailingElement, 'data-beui-quota-placeholder')
      clearQuotaCompensation()
    }
  }

  const prepareQuotaPlaceholder = (): void => {
    if (model?.getAttribute('aria-expanded') !== 'false') return
    syncQuotaPlaceholder()
    quotaTransitionActive = true
    showQuotaPlaceholder()
  }
  model?.addEventListener('click', prepareQuotaPlaceholder, true)

  const scanDynamicContents = (): void => {
    scanMenus()
    const nextModel = card.querySelector('[data-slot="conversation.input.model"] button')
    if (nextModel !== model) {
      model?.removeEventListener('click', prepareQuotaPlaceholder, true)
      removeClass(model, 'cvxBeuiPromptInputModel')
      unmark(model, 'data-beui-prompt-model')
      model = nextModel
      addClass(model, 'cvxBeuiPromptInputModel')
      mark(model, 'data-beui-prompt-model')
      model?.addEventListener('click', prepareQuotaPlaceholder, true)
    }
    const nextModelMenu = card.querySelector<HTMLElement>('[data-slot="conversation.input.model"] [role="menu"]') ?? undefined
    if (nextModelMenu !== modelMenu) {
      if (modelMenu !== undefined) {
        modelMenuResizeObserver.unobserve(modelMenu)
        modelMenu.style.removeProperty('--cvx-beui-model-menu-shift')
        unmark(modelMenu, 'data-beui-model-menu')
      }
      modelMenu = nextModelMenu
      if (modelMenu !== undefined) {
        mark(modelMenu, 'data-beui-model-menu')
        modelMenuResizeObserver.observe(modelMenu)
      }
    }
    syncQuotaPlaceholder()
    scheduleModelMenuAlignment()
  }
  scanDynamicContents()
  const menuObserver = new MutationObserver(scanDynamicContents)
  menuObserver.observe(card, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })

  return () => {
    disposed = true
    model?.removeEventListener('click', prepareQuotaPlaceholder, true)
    if (modelMenuFrame !== undefined) window.cancelAnimationFrame(modelMenuFrame)
    modelMenuResizeObserver.disconnect()
    if (modelMenu !== undefined) {
      modelMenu.style.removeProperty('--cvx-beui-model-menu-shift')
      unmark(modelMenu, 'data-beui-model-menu')
    }
    unmark(trailing, 'data-beui-quota-placeholder')
    clearQuotaCompensation()
    const trailingElement = trailing as HTMLElement | undefined
    trailingElement?.style.removeProperty('--cvx-beui-quota-progress')
    trailingElement?.style.removeProperty('--cvx-beui-quota-track')
    trailingElement?.style.removeProperty('--cvx-beui-quota-color')
    trailingElement?.style.removeProperty('--cvx-beui-quota-right')
    trailingElement?.style.removeProperty('--cvx-beui-quota-top')
    addObserver?.disconnect()
    sendObserver?.disconnect()
    menuObserver.disconnect()
    for (const cleanup of menus.values()) cleanup()
    menus.clear()
    addIcon?.getAnimations().forEach(animation => { animation.cancel() })
    sendIcon?.getAnimations().forEach(animation => { animation.cancel() })
    if (addIcon !== undefined) addIcon.style.removeProperty('transform')
    if (add !== undefined) delete add.dataset.beuiState
    removeClass(root, 'cvxBeuiPromptInputRoot')
    removeClass(card, 'cvxBeuiPromptInput')
    removeClass(scroll, 'cvxBeuiPromptInputScroll')
    removeClass(textarea, 'cvxBeuiPromptInputText')
    removeClass(backdrop, 'cvxBeuiPromptInputBackdrop')
    removeClass(mirror, 'cvxBeuiPromptInputMirror')
    removeClass(row, 'cvxBeuiPromptInputRow')
    removeClass(tools, 'cvxBeuiPromptInputTools')
    removeClass(trailing, 'cvxBeuiPromptInputTrailing')
    removeClass(add, 'cvxBeuiPromptInputAdd')
    removeClass(addIcon, 'cvxBeuiPromptInputAddIcon')
    removeClass(model, 'cvxBeuiPromptInputModel')
    removeClass(send, 'cvxBeuiPromptInputSend')
    removeClass(sendIcon, 'cvxBeuiPromptInputSendIcon')
    unmark(root, 'data-beui-prompt-root')
    unmark(card, 'data-beui-prompt-input')
    unmark(scroll, 'data-beui-prompt-scroll')
    unmark(textarea, 'data-beui-prompt-text')
    unmark(backdrop, 'data-beui-prompt-backdrop')
    unmark(mirror, 'data-beui-prompt-mirror')
    unmark(row, 'data-beui-prompt-row')
    unmark(tools, 'data-beui-prompt-tools')
    unmark(trailing, 'data-beui-prompt-trailing')
    unmark(add, 'data-beui-prompt-add')
    unmark(addIcon, 'data-beui-prompt-add-icon')
    unmark(model, 'data-beui-prompt-model')
    unmark(send, 'data-beui-prompt-send')
    unmark(sendIcon, 'data-beui-prompt-send-icon')
  }
}

/**
 * Applies BeUI Prompt Input presentation and motion to the official DSH
 * composer DOM while leaving its value, menus, attachments, queue, and send
 * handlers under the upstream conversation occupant.
 */
export function mountBeuiConversationComposer(root: HTMLElement): Cleanup {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const cards = new Map<HTMLElement, Cleanup>()
  const workspaceSwitches = new Set<HTMLButtonElement>()
  const headlines = new Map<Text, { readonly source: string; readonly target: string }>()
  const scanChrome = (): void => {
    for (const button of workspaceSwitches) {
      if (root.contains(button)) continue
      workspaceSwitches.delete(button)
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(WORKSPACE_SWITCH_SELECTOR)) {
      if (button.getAttribute('aria-expanded') === 'true') button.click()
      mark(button, 'data-beui-agent-workspace-switch')
      workspaceSwitches.add(button)
    }

    for (const [node, rewrite] of headlines) {
      if (!root.contains(node)) {
        headlines.delete(node)
        continue
      }
      if (node.data === rewrite.source) node.data = rewrite.target
    }
    if (workspaceSwitches.size === 0 || Array.from(headlines.keys()).some(node => root.contains(node))) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode() !== null) {
      const node = walker.currentNode as Text
      const source = node.data.trim()
      const target = projectAgentHeadline(source)
      if (target === source) continue
      headlines.set(node, { source, target })
      node.data = target
      break
    }
  }
  const scan = (): void => {
    scanChrome()
    for (const [card, cleanup] of cards) {
      if (root.contains(card)) continue
      cleanup()
      cards.delete(card)
    }
    for (const card of root.querySelectorAll<HTMLElement>('[data-composer-card="true"]')) {
      if (cards.has(card)) continue
      cards.set(card, decoratePromptCard(card, reduce))
    }
  }
  scan()
  const observer = new MutationObserver(scan)
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const button of workspaceSwitches) unmark(button, 'data-beui-agent-workspace-switch')
    workspaceSwitches.clear()
    for (const [node, rewrite] of headlines) {
      if (root.contains(node) && node.data === rewrite.target) node.data = rewrite.source
    }
    headlines.clear()
    for (const cleanup of cards.values()) cleanup()
    cards.clear()
  }
}
