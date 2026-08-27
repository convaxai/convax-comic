import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  CANVAS_PROJECT_VERSION,
  parseCanvasDocument,
  parseCanvasProject,
  serializeCanvasDocument,
  serializeCanvasProject,
  type CanvasDocumentV1,
  type CanvasPointV1,
  type CanvasProjectV1,
} from './schema.js'
import { CanvasWorkspace, type CanvasConnectInput, type CanvasCreateNodeInput, type CanvasUpdateNodePatch } from './client/store.js'
import type { CanvasWireSnapshot, CanvasWireSummary } from './remote-contract.js'

export interface CanvasSnapshot {
  readonly revision: number
  readonly document: CanvasDocumentV1
}

export interface CanvasServiceConfig {
  /** Product-owned data root. Runtime normally supplies CONVAX_PROJECTS_HOME. */
  readonly dataDir?: string
}

export class CanvasRevisionConflict extends Error {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number) {
    super(`canvas revision conflict: expected ${expected}, current ${actual}`)
    this.name = 'CanvasRevisionConflict'
    this.expected = expected
    this.actual = actual
  }
}

function persistencePath(config: CanvasServiceConfig): string | undefined {
  const root = config.dataDir ?? process.env.CONVAX_PROJECTS_HOME
  if (root === undefined) return undefined
  if (!isAbsolute(root)) throw new TypeError('canvas dataDir must be absolute')
  return join(root, 'default', 'canvas.canvas.json')
}

async function readInitialDocument(path: string | undefined): Promise<unknown | undefined> {
  if (path === undefined) return undefined
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function createDefaultDocument(title = 'Untitled canvas'): CanvasDocumentV1 {
  const workspace = new CanvasWorkspace()
  const base = workspace.getSnapshot().document
  workspace.dispose()
  return parseCanvasDocument({ ...base, title })
}

function initialProject(input: unknown | undefined): CanvasProjectV1 {
  if (input === undefined) {
    const document = createDefaultDocument()
    return parseCanvasProject({
      version: CANVAS_PROJECT_VERSION,
      id: 'project:default',
      activeCanvasId: document.id,
      canvases: [document],
    })
  }
  try {
    return parseCanvasProject(input)
  } catch {
    const document = parseCanvasDocument(input)
    return parseCanvasProject({
      version: CANVAS_PROJECT_VERSION,
      id: 'project:default',
      activeCanvasId: document.id,
      canvases: [document],
    })
  }
}

function activeDocument(project: CanvasProjectV1): CanvasDocumentV1 {
  const document = project.canvases.find(canvas => canvas.id === project.activeCanvasId)
  if (document === undefined) throw new Error(`active canvas not found: ${project.activeCanvasId}`)
  return document
}

function summaries(project: CanvasProjectV1): readonly CanvasWireSummary[] {
  return Object.freeze(project.canvases.map(canvas => {
    const visibleNodeIds = new Set(canvas.nodes.filter(node => node.kind !== 'video').map(node => node.id))
    return Object.freeze({
      id: canvas.id,
      title: canvas.title,
      nodeCount: visibleNodeIds.size,
      edgeCount: canvas.edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)).length,
    })
  }))
}

/** Host-owned Canvas authority exposed as ctx.canvas and through DSH Remote. */
export class CanvasService extends TypertRemoteService {
  private readonly workspace: CanvasWorkspace
  private readonly persistenceFile: string | undefined
  private project: CanvasProjectV1
  private revision = 0
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(ctx: Context, initialDocument: unknown | undefined, path: string | undefined) {
    super(ctx, 'canvas')
    this.persistenceFile = path
    this.project = initialProject(initialDocument)
    this.workspace = new CanvasWorkspace({
      initialDocument: activeDocument(this.project),
      initiallyOpen: true,
    })
  }

  snapshot(): CanvasSnapshot {
    return Object.freeze({
      revision: this.revision,
      document: this.workspace.getSnapshot().document,
    })
  }

  readJson(): CanvasWireSnapshot {
    const snapshot = this.snapshot()
    return Object.freeze({
      revision: snapshot.revision,
      documentJson: serializeCanvasDocument(snapshot.document),
      activeCanvasId: this.project.activeCanvasId,
      canvases: summaries(this.project),
    })
  }

  async replaceJson(documentJson: string, expectedRevision: number): Promise<CanvasWireSnapshot> {
    await this.replace(parseCanvasDocument(documentJson), expectedRevision)
    return this.readJson()
  }

  async replace(document: unknown, expectedRevision = this.revision): Promise<CanvasSnapshot> {
    this.assertRevision(expectedRevision)
    const parsed = parseCanvasDocument(document)
    if (parsed.id !== this.project.activeCanvasId) {
      throw new Error(`replacement canvas id ${parsed.id} does not match active canvas ${this.project.activeCanvasId}`)
    }
    const nextProject = this.withActiveDocument(parsed)
    await this.persist(nextProject)
    this.project = nextProject
    this.workspace.importDocument(parsed)
    this.revision += 1
    return this.snapshot()
  }

  async createCanvasJson(title: string, expectedRevision: number): Promise<CanvasWireSnapshot> {
    await this.createCanvas(title, expectedRevision)
    return this.readJson()
  }

  async createCanvas(title = '', expectedRevision = this.revision): Promise<CanvasSnapshot> {
    this.assertRevision(expectedRevision)
    const resolvedTitle = title.trim() || `画布 ${this.project.canvases.length + 1}`
    const document = createDefaultDocument(resolvedTitle)
    const nextProject = parseCanvasProject({
      ...this.project,
      activeCanvasId: document.id,
      canvases: [...this.project.canvases, document],
    })
    await this.persist(nextProject)
    this.project = nextProject
    this.workspace.syncDocument(document)
    this.revision += 1
    return this.snapshot()
  }

  async selectCanvasJson(canvasId: string, expectedRevision: number): Promise<CanvasWireSnapshot> {
    await this.selectCanvas(canvasId, expectedRevision)
    return this.readJson()
  }

  async selectCanvas(canvasId: string, expectedRevision = this.revision): Promise<CanvasSnapshot> {
    this.assertRevision(expectedRevision)
    if (canvasId === this.project.activeCanvasId) return this.snapshot()
    const document = this.project.canvases.find(canvas => canvas.id === canvasId)
    if (document === undefined) throw new Error(`canvas not found: ${canvasId}`)
    const nextProject = parseCanvasProject({ ...this.project, activeCanvasId: canvasId })
    await this.persist(nextProject)
    this.project = nextProject
    this.workspace.syncDocument(document)
    this.revision += 1
    return this.snapshot()
  }

  async createNode(input: CanvasCreateNodeInput): Promise<{ readonly id: string; readonly snapshot: CanvasSnapshot }> {
    const id = this.workspace.createNode(input)
    return { id, snapshot: await this.commitMutation() }
  }

  async updateNode(id: string, patch: CanvasUpdateNodePatch): Promise<CanvasSnapshot> {
    this.workspace.updateNode(id, patch)
    return this.commitMutation()
  }

  async removeNodes(ids: readonly string[]): Promise<CanvasSnapshot> {
    this.workspace.removeNodes(ids)
    return this.commitMutation()
  }

  async connect(input: CanvasConnectInput): Promise<{ readonly id: string; readonly snapshot: CanvasSnapshot }> {
    const id = this.workspace.connect(input)
    return { id, snapshot: await this.commitMutation() }
  }

  async setViewport(viewport: CanvasPointV1 & { readonly zoom: number }): Promise<CanvasSnapshot> {
    this.workspace.setViewport(viewport)
    return this.commitMutation()
  }

  async flush(): Promise<void> {
    await this.writeQueue
  }

  dispose(): void {
    this.workspace.dispose()
  }

  private async commitMutation(): Promise<CanvasSnapshot> {
    const document = this.workspace.getSnapshot().document
    const nextProject = this.withActiveDocument(document)
    await this.persist(nextProject)
    this.project = nextProject
    this.revision += 1
    return this.snapshot()
  }

  private withActiveDocument(document: CanvasDocumentV1): CanvasProjectV1 {
    return parseCanvasProject({
      ...this.project,
      canvases: this.project.canvases.map(canvas => canvas.id === this.project.activeCanvasId ? document : canvas),
    })
  }

  private assertRevision(expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 0) throw new TypeError('expectedRevision must be a non-negative safe integer')
    if (expected !== this.revision) throw new CanvasRevisionConflict(expected, this.revision)
  }

  private async persist(project: CanvasProjectV1): Promise<void> {
    if (this.persistenceFile === undefined) return
    const path = this.persistenceFile
    const contents = `${serializeCanvasProject(project)}\n`
    const write = this.writeQueue.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
    })
    this.writeQueue = write.catch(() => undefined)
    await write
  }
}

export async function createCanvasService(ctx: Context, config: CanvasServiceConfig = {}): Promise<CanvasService> {
  const path = persistencePath(config)
  return new CanvasService(ctx, await readInitialDocument(path), path)
}
