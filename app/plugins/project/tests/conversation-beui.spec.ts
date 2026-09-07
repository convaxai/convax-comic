import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BEUI_PROMPT_ADD_CLOSED_KEYFRAMES,
  BEUI_PROMPT_ADD_OPEN_KEYFRAMES,
  BEUI_PROMPT_MENU_KEYFRAMES,
  BEUI_PROMPT_SWAP_KEYFRAMES,
  projectAgentHeadline,
  projectInlinePopupShift,
} from '../src/client/conversation-beui.js'

const source = await readFile(new URL('../src/client/conversation-beui.ts', import.meta.url), 'utf8')

describe('official conversation BeUI adapter', () => {
  it('uses an overshooting add-button swap that settles at the BeUI open angle', () => {
    expect(BEUI_PROMPT_ADD_OPEN_KEYFRAMES.at(0)?.transform).toBe('rotate(0deg) scale(1)')
    expect(BEUI_PROMPT_ADD_OPEN_KEYFRAMES.some(frame => frame.transform === 'rotate(52deg) scale(1.04)')).toBe(true)
    expect(BEUI_PROMPT_ADD_OPEN_KEYFRAMES.at(-1)?.transform).toBe('rotate(45deg) scale(1)')
    expect(BEUI_PROMPT_ADD_CLOSED_KEYFRAMES.at(-1)?.transform).toBe('rotate(0deg) scale(1)')
  })

  it('owns the product hero copy and removes the duplicate workspace switch affordance', () => {
    expect(projectAgentHeadline('探索未至之境')).toBe('实现你的任何想法')
    expect(projectAgentHeadline('Into the Unknown')).toBe('Bring any idea to life')
    expect(projectAgentHeadline('Other')).toBe('Other')
    expect(source).toContain('WORKSPACE_SWITCH_SELECTOR')
    expect(source).toContain("mark(button, 'data-beui-agent-workspace-switch')")
  })

  it('keeps compact model popups inside the composer bounds', () => {
    expect(projectInlinePopupShift({ left: 100, right: 400 }, { left: 20, right: 270 })).toBe(88)
    expect(projectInlinePopupShift({ left: 100, right: 400 }, { left: 350, right: 600 })).toBe(-208)
    expect(projectInlinePopupShift({ left: 100, right: 400 }, { left: 120, right: 360 })).toBe(0)
    expect(source).toContain("mark(modelMenu, 'data-beui-model-menu')")
    expect(source).toContain("modelMenuResizeObserver.observe(card)")
  })

  it('keeps the last quota bar painted while the model menu temporarily removes its live control', () => {
    expect(source).toContain('const syncQuotaPlaceholder = (): void =>')
    expect(source).toContain("trailingElement.style.setProperty('--cvx-beui-quota-progress', progressWidth)")
    expect(source).toContain("mark(trailingElement, 'data-beui-quota-placeholder')")
    expect(source).toContain("mark(target, 'data-beui-quota-compensate')")
    expect(source).toContain('const renderedTrailingItems = (trailingElement: HTMLElement): HTMLElement[] =>')
    expect(source).toContain('quotaTransitionActive = true')
    expect(source).toContain('if (quota === undefined && quotaTransitionActive)')
    expect(source).toContain("model?.addEventListener('click', prepareQuotaPlaceholder, true)")
    expect(source).toContain("model?.removeEventListener('click', prepareQuotaPlaceholder, true)")
    expect(source).toContain("attributeFilter: ['aria-expanded']")
    expect(source).toContain("trailingElement?.style.removeProperty('--cvx-beui-quota-progress')")
  })

  it('marks the visible backdrop so text and transparent-textarea caret share typography', () => {
    expect(source).toContain("const backdrop = card.querySelector('[data-input-backdrop]')")
    expect(source).toContain("mark(backdrop, 'data-beui-prompt-backdrop')")
    expect(source).toContain("unmark(backdrop, 'data-beui-prompt-backdrop')")
  })

  it('decorates rather than replacing the upstream composer behavior owner', () => {
    expect(source).toContain('Source: https://beui.dev/components/agents/prompt-input')
    expect(source).toContain("root.querySelectorAll<HTMLElement>('[data-composer-card=\"true\"]')")
    expect(source).toContain("mark(card, 'data-beui-prompt-input')")
    expect(source).toContain("attributeFilter: ['aria-expanded']")
    expect(source).toContain("ADD_DURATION, 'linear'")
    expect(source).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')")
    expect(source).toContain('new MutationObserver(scan)')
    expect(source).toContain("mark(menu, 'data-beui-prompt-menu')")
    expect(source).toContain('const scanDynamicContents = (): void =>')
    expect(BEUI_PROMPT_MENU_KEYFRAMES.at(0)?.clipPath).toContain('inset(92% 92%')
    expect(BEUI_PROMPT_SWAP_KEYFRAMES.at(-1)).toMatchObject({ opacity: 1, transform: 'translateY(0) scale(1)' })
  })
})
