import type { Context } from '@deepseek-ai/cordis'
import {
  TypertRemoteService,
  type RemoteResult,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  ApplyCanvasPatchRequest,
  ApplyCanvasPatchResult,
  CanvasDocument,
  CanvasDocumentSummary,
  CanvasHostApi,
  CanvasProject,
  CanvasProjectSummary,
  CreateCanvasDocumentRequest,
  CreateCanvasProjectRequest,
  DeleteCanvasDocumentRequest,
  DeleteCanvasDocumentResult,
  DeleteCanvasProjectRequest,
  DeleteCanvasProjectResult,
  GetCanvasDocumentRequest,
  GetCanvasProjectRequest,
  ListCanvasDocumentsRequest,
  ListCanvasProjectsRequest,
  RenameCanvasDocumentRequest,
  SetActiveCanvasRequest,
  WaitForCanvasRevisionRequest,
  WaitForCanvasRevisionResult,
} from '@convax/canvas-api'
import { CANVAS_REMOTE_V2_CONTRIBUTION } from './remote-v2-contract.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'canvasV2/listProjects': (request: ListCanvasProjectsRequest) => Promise<RemoteResult<readonly CanvasProjectSummary[]>>
    'canvasV2/createProject': (request: CreateCanvasProjectRequest) => Promise<RemoteResult<CanvasProject>>
    'canvasV2/getProject': (request: GetCanvasProjectRequest) => Promise<RemoteResult<CanvasProject>>
    'canvasV2/setActiveCanvas': (request: SetActiveCanvasRequest) => Promise<RemoteResult<CanvasProject>>
    'canvasV2/deleteProject': (request: DeleteCanvasProjectRequest) => Promise<RemoteResult<DeleteCanvasProjectResult>>
    'canvasV2/listDocuments': (request: ListCanvasDocumentsRequest) => Promise<RemoteResult<readonly CanvasDocumentSummary[]>>
    'canvasV2/createDocument': (request: CreateCanvasDocumentRequest) => Promise<RemoteResult<CanvasDocument>>
    'canvasV2/getDocument': (request: GetCanvasDocumentRequest) => Promise<RemoteResult<CanvasDocument>>
    'canvasV2/renameDocument': (request: RenameCanvasDocumentRequest) => Promise<RemoteResult<CanvasDocument>>
    'canvasV2/deleteDocument': (request: DeleteCanvasDocumentRequest) => Promise<RemoteResult<DeleteCanvasDocumentResult>>
    'canvasV2/applyPatch': (request: ApplyCanvasPatchRequest) => Promise<RemoteResult<ApplyCanvasPatchResult>>
    'canvasV2/waitForRevision': (request: WaitForCanvasRevisionRequest, signal: AbortSignal) => Promise<RemoteResult<WaitForCanvasRevisionResult>>
  }

  interface TypertRemoteNamespaceMap {
    canvasV2: {
      listProjects: TypertRemoteMap['canvasV2/listProjects']
      createProject: TypertRemoteMap['canvasV2/createProject']
      getProject: TypertRemoteMap['canvasV2/getProject']
      setActiveCanvas: TypertRemoteMap['canvasV2/setActiveCanvas']
      deleteProject: TypertRemoteMap['canvasV2/deleteProject']
      listDocuments: TypertRemoteMap['canvasV2/listDocuments']
      createDocument: TypertRemoteMap['canvasV2/createDocument']
      getDocument: TypertRemoteMap['canvasV2/getDocument']
      renameDocument: TypertRemoteMap['canvasV2/renameDocument']
      deleteDocument: TypertRemoteMap['canvasV2/deleteDocument']
      applyPatch: TypertRemoteMap['canvasV2/applyPatch']
      waitForRevision: TypertRemoteMap['canvasV2/waitForRevision']
    }
  }
}

/** Stateless Remote projection over the Host-owned Canvas V2 service. */
export class CanvasRemoteV2Service extends TypertRemoteService {
  static inject = ['canvasHost']

  /** Public for Cordis Service proxy method receivers; the Host authority remains internal. */
  readonly host: CanvasHostApi

  constructor(ctx: Context) {
    super(ctx, 'canvasRemoteV2', { namespace: 'canvasV2' })
    this.host = ctx.canvasHost
  }

  listProjects(request: ListCanvasProjectsRequest): Promise<readonly CanvasProjectSummary[]> {
    return this.host.projects.list(request)
  }

  createProject(request: CreateCanvasProjectRequest): Promise<CanvasProject> {
    return this.host.projects.create(request)
  }

  getProject(request: GetCanvasProjectRequest): Promise<CanvasProject> {
    return this.host.projects.get(request)
  }

  setActiveCanvas(request: SetActiveCanvasRequest): Promise<CanvasProject> {
    return this.host.projects.setActiveCanvas(request)
  }

  deleteProject(request: DeleteCanvasProjectRequest): Promise<DeleteCanvasProjectResult> {
    return this.host.projects.delete(request)
  }

  listDocuments(request: ListCanvasDocumentsRequest): Promise<readonly CanvasDocumentSummary[]> {
    return this.host.documents.list(request)
  }

  createDocument(request: CreateCanvasDocumentRequest): Promise<CanvasDocument> {
    return this.host.documents.createAndActivate(request)
  }

  getDocument(request: GetCanvasDocumentRequest): Promise<CanvasDocument> {
    return this.host.documents.get(request)
  }

  renameDocument(request: RenameCanvasDocumentRequest): Promise<CanvasDocument> {
    return this.host.documents.rename(request)
  }

  deleteDocument(request: DeleteCanvasDocumentRequest): Promise<DeleteCanvasDocumentResult> {
    return this.host.documents.delete(request)
  }

  applyPatch(request: ApplyCanvasPatchRequest): Promise<ApplyCanvasPatchResult> {
    return this.host.documents.applyPatch(request)
  }

  waitForRevision(
    request: WaitForCanvasRevisionRequest,
    signal: AbortSignal,
  ): Promise<WaitForCanvasRevisionResult> {
    return this.host.documents.waitForRevision(request, signal)
  }
}

export const TYPERT_REMOTE_V2 = CANVAS_REMOTE_V2_CONTRIBUTION
export default TYPERT_REMOTE_V2
