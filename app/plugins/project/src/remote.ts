import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  CloseProjectFilesRequest,
  CloseProjectFilesResult,
  ListProjectFilesRequest,
  ListProjectFilesResult,
  OpenProjectFilesRequest,
  OpenProjectFilesResult,
  PreviewProjectFileRequest,
  PreviewProjectFileResult,
  ReadProjectFileRequest,
  ReadProjectFileResult,
  ReleaseProjectFilePreviewRequest,
  ReleaseProjectFilePreviewResult,
  WaitProjectFilesRequest,
  WaitProjectFilesResult,
} from './contracts.js'
import { PROJECT_FILES_REMOTE_CONTRIBUTION } from './remote-contract.js'
import type { ProjectFilesManager } from './host/project-files.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'projectFiles/open': (request: OpenProjectFilesRequest) => Promise<RemoteResult<OpenProjectFilesResult>>
    'projectFiles/list': (request: ListProjectFilesRequest) => Promise<RemoteResult<ListProjectFilesResult>>
    'projectFiles/read': (request: ReadProjectFileRequest, signal: AbortSignal) => Promise<RemoteResult<ReadProjectFileResult>>
    'projectFiles/preview': (request: PreviewProjectFileRequest, signal: AbortSignal) => Promise<RemoteResult<PreviewProjectFileResult>>
    'projectFiles/releasePreview': (request: ReleaseProjectFilePreviewRequest) => Promise<RemoteResult<ReleaseProjectFilePreviewResult>>
    'projectFiles/wait': (request: WaitProjectFilesRequest, signal: AbortSignal) => Promise<RemoteResult<WaitProjectFilesResult>>
    'projectFiles/close': (request: CloseProjectFilesRequest) => Promise<RemoteResult<CloseProjectFilesResult>>
  }
  interface TypertRemoteNamespaceMap {
    projectFiles: {
      open: TypertRemoteMap['projectFiles/open']
      list: TypertRemoteMap['projectFiles/list']
      read: TypertRemoteMap['projectFiles/read']
      preview: TypertRemoteMap['projectFiles/preview']
      releasePreview: TypertRemoteMap['projectFiles/releasePreview']
      wait: TypertRemoteMap['projectFiles/wait']
      close: TypertRemoteMap['projectFiles/close']
    }
  }
}

export class ProjectFilesRemoteService extends TypertRemoteService {
  /** Public because Cordis Service methods execute with the service proxy as their receiver. */
  readonly manager: ProjectFilesManager

  constructor(ctx: Context, manager: ProjectFilesManager) {
    super(ctx, 'projectFilesRemote', { namespace: 'projectFiles' })
    this.manager = manager
  }

  open(request: OpenProjectFilesRequest): Promise<OpenProjectFilesResult> { return this.manager.open(request) }
  list(request: ListProjectFilesRequest): Promise<ListProjectFilesResult> { return this.manager.list(request) }
  read(request: ReadProjectFileRequest, signal: AbortSignal): Promise<ReadProjectFileResult> {
    return this.manager.read(request, signal)
  }
  preview(request: PreviewProjectFileRequest, signal: AbortSignal): Promise<PreviewProjectFileResult> {
    return this.manager.preview(request, signal)
  }
  releasePreview(request: ReleaseProjectFilePreviewRequest): Promise<ReleaseProjectFilePreviewResult> {
    return this.manager.releasePreview(request.previewId)
  }
  wait(request: WaitProjectFilesRequest, signal: AbortSignal): Promise<WaitProjectFilesResult> {
    return this.manager.wait(request, signal)
  }
  close(request: CloseProjectFilesRequest): Promise<CloseProjectFilesResult> {
    return this.manager.closeLease(request.leaseId)
  }
}

export const TYPERT_PROJECT_FILES_REMOTE = PROJECT_FILES_REMOTE_CONTRIBUTION
