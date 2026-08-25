import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC, type DesktopPreloadApi, type LaunchContext } from './types.js'

function immutableContext(context: LaunchContext): Readonly<LaunchContext> {
  return Object.freeze({
    origin: context.origin,
    token: context.token,
    profile: context.profile,
    ready: context.ready,
    generation: context.generation,
  })
}

const native = Object.freeze({})
const api: DesktopPreloadApi = Object.freeze({
  native,
  getLaunchContext(): Readonly<LaunchContext> {
    return immutableContext(ipcRenderer.sendSync(DESKTOP_IPC.getLaunchContext) as LaunchContext)
  },
  retry(): Promise<void> {
    return ipcRenderer.invoke(DESKTOP_IPC.retry) as Promise<void>
  },
  openLogs(): Promise<void> {
    return ipcRenderer.invoke(DESKTOP_IPC.openLogs) as Promise<void>
  },
  quit(): Promise<void> {
    return ipcRenderer.invoke(DESKTOP_IPC.quit) as Promise<void>
  },
  onOriginChanged(listener: (context: Readonly<LaunchContext>) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('origin listener must be a function')
    const wrapped = (_event: Electron.IpcRendererEvent, context: LaunchContext) => {
      listener(immutableContext(context))
    }
    ipcRenderer.on(DESKTOP_IPC.originChanged, wrapped)
    return () => ipcRenderer.removeListener(DESKTOP_IPC.originChanged, wrapped)
  },
})

contextBridge.exposeInMainWorld('convaxDesktop', api)
