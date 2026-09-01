import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Projects the theme service snapshot onto the DOM when the upstream layout is replaced. */
export class ConvaxThemePresenter {
  readonly #document: Document
  readonly #themeColorMeta: HTMLMetaElement
  #appliedTokens: string[] = []

  constructor(document: Document) {
    this.#document = document
    this.#themeColorMeta = document.createElement('meta')
    this.#themeColorMeta.name = 'theme-color'
  }

  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    const root = this.#document.documentElement
    const body = this.#document.body
    root.style.setProperty('color-scheme', scheme)
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)

    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.#appliedTokens.push(name)
    }

    const background = this.#document.defaultView?.getComputedStyle(body).backgroundColor
    if (background !== undefined && background !== '') this.#themeColorMeta.content = background
    if (!this.#themeColorMeta.isConnected) this.#document.head.append(this.#themeColorMeta)
  }

  dispose(): void {
    const body = this.#document.body
    this.#document.documentElement.style.removeProperty('color-scheme')
    body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    this.#themeColorMeta.remove()
  }
}
