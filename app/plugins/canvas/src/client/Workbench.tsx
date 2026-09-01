import {
  Button,
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from '@convax/beui'
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import {
  CanvasIcon,
  CanvasStyles,
  CanvasView,
  ChevronRightIcon,
  KindIcon,
  PlusIcon,
  kindLabel,
} from './CanvasView.tsx'
import { ComicCanvasWorkspace } from './comic-workspace-v2.js'
import type { CanvasProjectSync } from './project-sync-v2.js'

function useWorkspace(workspace: ComicCanvasWorkspace) {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot)
}

export function CanvasCenter({ workspace }: { readonly workspace: ComicCanvasWorkspace }): ReactElement {
  return (
    <>
      <CanvasStyles />
      <div className="cvxWorkbenchCanvas"><CanvasView workspace={workspace} /></div>
    </>
  )
}

export interface CanvasProjectCanvasesProps {
  readonly workspace: ComicCanvasWorkspace
  readonly canvasProject: CanvasProjectSync
}

const canvasTreeValue = (canvasId: string): string => `canvas:${canvasId}`
const canvasNodeTreeValue = (nodeId: string): string => `node:${nodeId}`

/** Canvas-owned collapsible section nested through the project sidebar Slot. */
export function CanvasProjectCanvases({ workspace, canvasProject }: CanvasProjectCanvasesProps): ReactElement {
  const snapshot = useWorkspace(workspace)
  const projectSnapshot = useSyncExternalStore(canvasProject.subscribe, canvasProject.getSnapshot, canvasProject.getSnapshot)
  const [expanded, setExpanded] = useState(true)
  const activeFolderId = canvasTreeValue(projectSnapshot.activeCanvasId)
  const [expandedCanvasIds, setExpandedCanvasIds] = useState<readonly string[]>([activeFolderId])
  const [projectError, setProjectError] = useState<string>()
  const selectedNodeId = snapshot.selection.nodeIds[0]
  const selectedTreeValue = selectedNodeId === undefined ? activeFolderId : canvasNodeTreeValue(selectedNodeId)
  useEffect(() => {
    setExpandedCanvasIds(current => current.includes(activeFolderId) ? current : [...current, activeFolderId])
  }, [activeFolderId])
  const runProjectAction = (action: () => Promise<unknown>): void => {
    setProjectError(undefined)
    void action().catch(error => { setProjectError(error instanceof Error ? error.message : String(error)) })
  }
  return (
    <>
      <CanvasStyles />
      <section className="cvxTreeSection cvxCanvasTreeSection" aria-label="Canvases" data-expanded={expanded || undefined}>
        <header>
          <button
            type="button"
            className="cvxTreeSectionToggle"
            aria-expanded={expanded}
            onClick={() => { setExpanded(value => !value) }}
          >
            <ChevronRightIcon className="cvxTreeSectionChevron" size={14} />
            <span>Canvases</span>
            <small>{projectSnapshot.canvases.length}</small>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="cvxTreeAdd"
            aria-label="New canvas"
            title="New canvas"
            onClick={() => { runProjectAction(() => canvasProject.createCanvas()) }}
          ><PlusIcon size={13} /></Button>
        </header>
        {expanded && (
          <div className="cvxTreeSectionBody">
            <FileTree
              ariaLabel="Canvases"
              className="cvxCanvasFileTree"
              value={selectedTreeValue}
              expandedIds={expandedCanvasIds}
              onExpandedChange={setExpandedCanvasIds}
              onValueChange={(value) => {
                if (value.startsWith('canvas:')) {
                  runProjectAction(() => canvasProject.selectCanvas(value.slice('canvas:'.length)))
                } else if (value.startsWith('node:')) {
                  workspace.selectNode(value.slice('node:'.length))
                }
              }}
            >
              {projectSnapshot.canvases.map(canvas => {
                const active = canvas.id === projectSnapshot.activeCanvasId
                return (
                  <FileTreeFolder
                    key={canvas.id}
                    value={canvasTreeValue(canvas.id)}
                    name={`${canvas.title} · ${canvas.nodeCount}`}
                    icon={<CanvasIcon size={14} />}
                    {...(active ? { className: 'cvxCanvasTreeActive' } : {})}
                  >
                    {active && snapshot.document.nodes.map(node => (
                      <FileTreeFile
                        key={node.id}
                        value={canvasNodeTreeValue(node.id)}
                        name={node.title || kindLabel(node.kind)}
                        icon={<KindIcon kind={node.kind} size={13} />}
                      />
                    ))}
                  </FileTreeFolder>
                )
              })}
            </FileTree>
            {projectError !== undefined && <p className="cvxTreeError" role="alert">{projectError}</p>}
          </div>
        )}
      </section>
    </>
  )
}
