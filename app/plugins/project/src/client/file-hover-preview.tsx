import type { CSSProperties, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectFilePreviewSnapshot } from './file-drag-preview.js'

export interface ProjectFilePreviewAnchor {
  readonly path: string
  readonly top: number
  readonly left: number
  readonly right: number
}

export function ProjectFileHoverPreview({
  snapshot,
  anchor,
}: {
  readonly snapshot: ProjectFilePreviewSnapshot
  readonly anchor: ProjectFilePreviewAnchor | undefined
}): ReactElement | null {
  const active = snapshot.active
  if (anchor === undefined || active === undefined || active.path !== anchor.path || typeof document === 'undefined') return null
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  const width = Math.min(360, Math.max(240, window.innerWidth - 24))
  const fitsRight = anchor.right + 12 + width <= window.innerWidth - 12
  const left = fitsRight ? anchor.right + 12 : Math.max(12, anchor.left - width - 12)
  const top = Math.max(12, Math.min(anchor.top - 8, window.innerHeight - 332))
  const style = { left, top, width } satisfies CSSProperties
  return createPortal(
    <aside
      className="cvxProjectFileHoverPreview"
      data-kind={active.kind}
      data-status={active.status}
      style={style}
      aria-hidden="true"
    >
      <div className="cvxProjectFileHoverPreviewHeader">{active.name}</div>
      <div className="cvxProjectFileHoverPreviewBody">
        {active.status === 'loading' && <div className="cvxProjectFileHoverPreviewLoading">Loading preview…</div>}
        {active.status === 'error' && <div className="cvxProjectFileHoverPreviewError">{active.message}</div>}
        {active.status === 'ready' && active.kind === 'image' && (
          <img className="cvxProjectFileHoverPreviewMedia" src={active.url} alt="" draggable={false} />
        )}
        {active.status === 'ready' && active.kind === 'video' && (
          <video
            className="cvxProjectFileHoverPreviewMedia"
            src={active.url}
            autoPlay={!reduceMotion}
            muted
            loop={!reduceMotion}
            playsInline
            preload="auto"
          />
        )}
        {active.status === 'ready' && active.kind === 'text' && (
          <pre className="cvxProjectFileHoverPreviewText">{active.text}</pre>
        )}
      </div>
    </aside>,
    document.body,
  )
}
