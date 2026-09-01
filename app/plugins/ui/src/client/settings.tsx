import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@convax/beui'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'

export const SETTINGS_NAMESPACE = 'convax.settings'

export const SETTINGS_MESSAGES = {
  zh: {
    trigger: '设置',
    title: '设置',
    close: '关闭',
    sections: '设置分类',
    empty: '暂无可用设置',
    'general.nav': '通用',
    openDocument: '打开配置文件',
    'openDocument.error': '无法打开配置文件',
  },
  en: {
    trigger: 'Settings',
    title: 'Settings',
    close: 'Close',
    sections: 'Settings sections',
    empty: 'No settings are available',
    'general.nav': 'General',
    openDocument: 'Open configuration file',
    'openDocument.error': 'Could not open configuration file',
  },
} as const

export type SettingsMessageKey = keyof typeof SETTINGS_MESSAGES.zh
export type SettingsTranslate = (key: SettingsMessageKey) => string

export interface SnapshotSource<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

export interface SettingsSectionRow {
  readonly id: string
  readonly order: number
  readonly label: string
}

type RenderSlot = (
  name: string,
  owner: Record<string, unknown>,
  options?: { readonly only?: string },
) => ReactNode

export interface ConvaxSettingsRootProps {
  readonly wide: boolean
  readonly t: SettingsTranslate
  readonly renderSlot: RenderSlot
  readonly sections: SnapshotSource<readonly SettingsSectionRow[]>
}

function SvgIcon({ children, size = 18 }: { readonly children: ReactNode; readonly size?: number }): ReactElement {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  )
}

function SettingsIcon({ size = 18 }: { readonly size?: number }): ReactElement {
  return (
    <SvgIcon size={size}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.92 1.92-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20H12.2v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-1.92-1.92.06-.06A1.7 1.7 0 0 0 7.7 15a1.7 1.7 0 0 0-1.56-1.04H6V11.2h.14A1.7 1.7 0 0 0 7.7 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.92-1.92.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 12.2 5V4.9h2.7V5a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.92 1.92-.06.06A1.7 1.7 0 0 0 19.4 10a1.7 1.7 0 0 0 1.56 1.04H21v2.72h-.04A1.7 1.7 0 0 0 19.4 15Z" />
    </SvgIcon>
  )
}

function CloseIcon(): ReactElement {
  return <SvgIcon size={17}><path d="m7 7 10 10M17 7 7 17" /></SvgIcon>
}

function SectionIcon({ id }: { readonly id: string }): ReactElement {
  if (id === 'models') return <SvgIcon><path d="M6 5h12v5H6zM6 14h12v5H6z" /><path d="M9 7.5h6M9 16.5h6" /></SvgIcon>
  if (id === 'plugins') return <SvgIcon><path d="M8 4v4H4v8h4v4h8v-4h4V8h-4V4z" /></SvgIcon>
  if (id === 'agent-presets') return <SvgIcon><circle cx="12" cy="8" r="3" /><path d="M6 20c.5-4 2.5-6 6-6s5.5 2 6 6" /></SvgIcon>
  return <SettingsIcon />
}

export function SettingsTriggerContent({ wide, t }: { readonly wide: boolean; readonly t: SettingsTranslate }): ReactElement {
  return (
    <span className="cvxSettingsTriggerContent">
      <SettingsIcon size={wide ? 17 : 19} />
      {wide && <span className="cvxSettingsTriggerLabel">{t('trigger')}</span>}
    </span>
  )
}

export function SettingsHeaderContent({ t }: { readonly t: SettingsTranslate }): ReactElement {
  return <>{t('title')}</>
}

export function SettingsCloseLabel({ t }: { readonly t: SettingsTranslate }): ReactElement {
  return <>{t('close')}</>
}

export function SettingsGeneralSection({ renderSlot }: { readonly renderSlot: RenderSlot }): ReactElement {
  return <div className="cvxSettingsGeneral">{renderSlot('settings.general.item', {})}</div>
}

interface SettingsPanelProps {
  readonly rows: readonly SettingsSectionRow[]
  readonly activeId: string
  readonly t: SettingsTranslate
  readonly renderSlot: RenderSlot
  readonly onSelect: (id: string) => void
  readonly onClose: () => void
}

function SettingsPanel({ rows, activeId, t, renderSlot, onSelect, onClose }: SettingsPanelProps): ReactElement {
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [onClose])

  const active = rows.find(row => row.id === activeId) ?? rows[0]
  const selected = active?.id ?? ''

  return (
    <div className="cvxSettingsOverlay" role="presentation">
      <button className="cvxSettingsBackdrop" type="button" tabIndex={-1} aria-label={t('close')} onClick={onClose} />
      <section className="cvxSettingsPanel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <Tabs className="cvxSettingsTabs" value={selected} onValueChange={onSelect} variant="segment">
          <nav className="cvxSettingsNav" aria-label={t('sections')}>
            <div id={titleId} className="cvxSettingsNavTitle">{renderSlot('settings.header', {})}</div>
            <TabsList ariaLabel={t('sections')}>
              {rows.map(row => (
                <TabsTrigger key={row.id} value={row.id}>
                  <span className="cvxSettingsNavIcon"><SectionIcon id={row.id} /></span>
                  <span className="cvxSettingsNavLabel">{row.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>
          <div className="cvxSettingsContent">
            <header className="cvxSettingsHeader">
              <div className="cvxSettingsSectionTitle">{active?.label ?? t('title')}</div>
              <div className="cvxSettingsHeaderActions">
                {renderSlot('settings.action', {})}
                <Button ref={closeButton} className="cvxSettingsClose" variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
                  <CloseIcon />
                  <span className="cvxSettingsSrOnly">{renderSlot('settings.close', {})}</span>
                </Button>
              </div>
            </header>
            <div className="cvxSettingsViewport">
              {active === undefined
                ? <div className="cvxSettingsEmpty">{t('empty')}</div>
                : (
                  <TabsContent className="cvxSettingsTabPanel" value={selected}>
                    {renderSlot('settings.section', { close: onClose }, { only: selected })}
                  </TabsContent>
                )}
            </div>
          </div>
        </Tabs>
      </section>
    </div>
  )
}

export function ConvaxSettingsRoot({
  wide,
  t,
  renderSlot,
  sections,
}: ConvaxSettingsRootProps): ReactElement {
  const rows = useSyncExternalStore(sections.subscribe, sections.getSnapshot, sections.getSnapshot)
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string>()
  const trigger = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
    trigger.current?.focus()
  }, [])
  const selected = rows.some(row => row.id === activeId) ? activeId ?? '' : rows[0]?.id ?? ''

  return (
    <>
      <Button
        ref={trigger}
        className="cvxSettingsTrigger"
        data-wide={String(wide)}
        variant="ghost"
        size="icon"
        aria-label={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        {renderSlot('settings.trigger', { wide })}
      </Button>
      {open && (
        <SettingsPanel
          rows={rows}
          activeId={selected}
          t={t}
          renderSlot={renderSlot}
          onSelect={setActiveId}
          onClose={close}
        />
      )}
    </>
  )
}

export interface SettingsDocumentState {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  readonly opening: boolean
  readonly error: string | null
}

interface SettingsDescribeLike {
  getSnapshot(): { readonly view: { readonly hasDocument: boolean } | undefined; readonly error: string | null }
  subscribe(listener: () => void): () => void
  ensure(): Promise<void>
}

interface SettingsApiLike {
  settings: {
    openDocument(args: Record<string, never>): Promise<{
      readonly result: { readonly ok: true } | { readonly ok: false; readonly error: { readonly message: string } }
    }>
  }
}

export class SettingsDocumentController {
  readonly #api: SettingsApiLike
  readonly #describe: SettingsDescribeLike
  readonly #listeners = new Set<() => void>()
  #state: SettingsDocumentState = { status: 'idle', opening: false, error: null }
  #following: (() => void) | undefined
  #disposed = false

  constructor(api: SettingsApiLike, describe: SettingsDescribeLike) {
    this.#api = api
    this.#describe = describe
  }

  readonly getSnapshot = (): SettingsDocumentState => this.#state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async load(): Promise<void> {
    if (this.#disposed) return
    this.#following ??= this.#describe.subscribe(() => { this.#derive() })
    this.#update({ status: 'loading', error: null })
    try {
      await this.#describe.ensure()
      this.#derive()
    } catch (error) {
      this.#update({ status: 'unavailable', error: messageOf(error) })
    }
  }

  async open(): Promise<void> {
    if (this.#disposed || this.#state.status !== 'ready' || this.#state.opening) return
    this.#update({ opening: true, error: null })
    try {
      const response = await this.#api.settings.openDocument({})
      if (!response.result.ok) throw new Error(response.result.error.message)
    } catch (error) {
      this.#update({ error: messageOf(error) })
    } finally {
      this.#update({ opening: false })
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#following?.()
    this.#following = undefined
    this.#listeners.clear()
  }

  #derive(): void {
    if (this.#disposed) return
    const snapshot = this.#describe.getSnapshot()
    if (snapshot.view === undefined) {
      if (snapshot.error !== null) this.#update({ status: 'unavailable', error: snapshot.error })
      return
    }
    this.#update({ status: snapshot.view.hasDocument ? 'ready' : 'unavailable', error: null })
  }

  #update(patch: Partial<SettingsDocumentState>): void {
    if (this.#disposed) return
    const next = { ...this.#state, ...patch }
    if (next.status === this.#state.status && next.opening === this.#state.opening && next.error === this.#state.error) return
    this.#state = next
    for (const listener of this.#listeners) listener()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SettingsDocumentAction({ controller, t }: {
  readonly controller: SettingsDocumentController
  readonly t: SettingsTranslate
}): ReactElement | null {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => { void controller.load() }, [controller])
  if (state.status !== 'ready') return null
  return (
    <div className="cvxSettingsDocumentAction">
      {state.error === null ? null : <span className="cvxSettingsDocumentError" role="alert">{t('openDocument.error')}</span>}
      <Button variant="outline" size="sm" disabled={state.opening} onClick={() => { void controller.open() }}>
        {t('openDocument')}
      </Button>
    </div>
  )
}
