import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { failurePageUrl, loadingPageUrl } from './failure-page.js'
import {
  desktopPaths,
  ensureDesktopPaths,
  parseDesktopLaunchOptions,
  type DesktopPaths,
} from './profile-args.js'
import {
  assertPureDataPatchSource,
  materializeProductProfile,
  profilePackageNames,
  resolveProductPackageTargets,
  resolveProfileSourceRoot,
} from './profile-materializer.js'
import { resolveDesktopRuntimePaths, verifyIndependentNodeRuntime } from './runtime-paths.js'
import {
  installControlTokenInjector,
  isTrustedDesktopDocument,
  navigationDecision,
  rendererLaunchContext,
} from './security.js'
import { DshSupervisor } from './supervisor.js'
import { DESKTOP_IPC, type LaunchContext } from './types.js'
import { desktopWindowOptions } from './window-options.js'

const productName = 'Convax Comic'
app.setName(productName)
app.setPath('userData', join(app.getPath('appData'), productName))

const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const desktopPackageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const launchOptions = parseDesktopLaunchOptions(process.argv)
const emptyContext: Readonly<LaunchContext> = Object.freeze({
  origin: null,
  token: null,
  profile: launchOptions.profile,
  ready: false,
  generation: 0,
})

let mainWindow: BrowserWindow | null = null
let supervisor: DshSupervisor | null = null
let paths: DesktopPaths | null = null
let quitting = false
let quitAllowed = false
let removeTokenInjector: (() => void) | null = null
let retryInFlight: Promise<void> | null = null

function currentContext(): Readonly<LaunchContext> {
  return supervisor?.getLaunchContext() ?? emptyContext
}

function sendContext(context: Readonly<LaunchContext>): void {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(
    DESKTOP_IPC.originChanged,
    { ...rendererLaunchContext(context, mainWindow.webContents.getURL()) },
  )
}

async function showFailure(message: string): Promise<void> {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  await mainWindow.loadURL(failurePageUrl(message))
  if (!mainWindow.isVisible()) mainWindow.show()
}

async function showLoading(message: string): Promise<void> {
  if (mainWindow === null || mainWindow.isDestroyed()) return
  await mainWindow.loadURL(loadingPageUrl(message))
  if (!mainWindow.isVisible()) mainWindow.show()
}

async function navigateToRuntime(context: Readonly<LaunchContext>): Promise<void> {
  if (context.origin === null || mainWindow === null || mainWindow.isDestroyed()) return
  await mainWindow.loadURL(context.origin)
  if (!mainWindow.isVisible()) mainWindow.show()
}

function attachWebContentsSecurity(contents: WebContents): void {
  const guardMainFrameNavigation = (event: Electron.Event, target: string) => {
    const decision = navigationDecision(target, currentContext().origin)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'external') void shell.openExternal(target).catch(() => undefined)
  }
  contents.on('will-navigate', guardMainFrameNavigation)
  contents.on('will-redirect', guardMainFrameNavigation)
  contents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame
      || navigationDecision(details.url, currentContext().origin) === 'allow') return
    details.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())

  contents.setWindowOpenHandler(({ url }) => {
    const decision = navigationDecision(url, currentContext().origin)
    if (decision === 'external') void shell.openExternal(url).catch(() => undefined)
    return { action: 'deny' }
  })
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(desktopWindowOptions(preloadPath))
  attachWebContentsSecurity(window.webContents)
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

function registerIpc(): void {
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
    if (mainWindow === null || mainWindow.isDestroyed()) return false
    const frame = event.senderFrame
    return event.sender === mainWindow.webContents
      && frame !== null
      && frame === event.sender.mainFrame
      && isTrustedDesktopDocument(frame.url, currentContext().origin)
  }
  const requireTrusted = (event: IpcMainInvokeEvent): void => {
    if (!trusted(event)) throw new Error('untrusted desktop IPC sender')
  }

  ipcMain.on(DESKTOP_IPC.getLaunchContext, (event) => {
    if (!trusted(event) || event.senderFrame === null) {
      event.returnValue = { ...emptyContext }
      return
    }
    event.returnValue = { ...rendererLaunchContext(currentContext(), event.senderFrame.url) }
  })
  ipcMain.handle(DESKTOP_IPC.retry, async (event) => {
    requireTrusted(event)
    if (quitting) return
    retryInFlight ??= (async () => {
      const previous = supervisor
      supervisor = null
      await previous?.stop()
      await startRuntime()
    })().finally(() => {
      retryInFlight = null
    })
    await retryInFlight
  })
  ipcMain.handle(DESKTOP_IPC.openLogs, async (event) => {
    requireTrusted(event)
    if (paths === null) return
    const error = await shell.openPath(paths.logs)
    if (error.length > 0) throw new Error('unable to open the desktop log directory')
  })
  ipcMain.handle(DESKTOP_IPC.quit, async (event) => {
    requireTrusted(event)
    setImmediate(() => app.quit())
  })
}

async function startRuntime(): Promise<void> {
  if (quitting) return
  if (paths === null) throw new Error('desktop paths are not initialized')
  try {
    const sourceProfilesRoot = resolveProfileSourceRoot({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      desktopPackageRoot,
    })
    const packageNames = profilePackageNames(readFileSync(
      join(sourceProfilesRoot, launchOptions.profile, 'cordis.patch.yml'),
      'utf8',
    ))
    const trustedSecurityPatch = join(sourceProfilesRoot, 'security.patch.yml')
    assertPureDataPatchSource(readFileSync(trustedSecurityPatch, 'utf8'))
    await materializeProductProfile({
      profile: launchOptions.profile,
      sourceProfilesRoot,
      harnessHome: paths.harnessHome,
      packageTargets: resolveProductPackageTargets(desktopPackageRoot, packageNames),
    })
    if (quitting) return
    const runtime = resolveDesktopRuntimePaths()
    verifyIndependentNodeRuntime(runtime.nodeBinary)
    supervisor = new DshSupervisor({
      ...runtime,
      profile: launchOptions.profile,
      trustedSecurityPatch,
      paths,
    })
    supervisor.on('context', (context) => {
      sendContext(context)
      if (!context.ready && supervisor?.status === 'starting') {
        void showLoading('DSH 正在安全启动，请稍候。')
      }
    })
    supervisor.on('ready', (context) => {
      void navigateToRuntime(context).then(() => {
        sendContext(context)
      }).catch(() => {
        void showFailure('运行时已就绪，但页面加载失败。')
      })
    })
    supervisor.on('failed', (error) => {
      void showFailure(error.message)
    })
    supervisor.start()
  } catch (cause) {
    supervisor = null
    const message = cause instanceof Error ? cause.message : '未知运行时错误'
    await showFailure(message)
  }
}

async function bootstrap(): Promise<void> {
  paths = desktopPaths(app.getPath('userData'))
  await ensureDesktopPaths(paths)
  app.setAppLogsPath(paths.logs)

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)
  registerIpc()
  mainWindow = createMainWindow()
  removeTokenInjector = installControlTokenInjector(
    session.defaultSession,
    currentContext,
    () => mainWindow?.webContents.id ?? null,
  )
  await showLoading('正在准备本地运行时与插件。')
  await startRuntime()
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createMainWindow()
    const context = currentContext()
    if (context.ready) void navigateToRuntime(context)
    else void showLoading('DSH 正在安全启动，请稍候。')
  }
})

app.on('before-quit', (event) => {
  if (quitAllowed) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  void (async () => {
    await retryInFlight?.catch(() => undefined)
    await supervisor?.stop()
  })().finally(() => {
    removeTokenInjector?.()
    removeTokenInjector = null
    quitAllowed = true
    app.quit()
  })
})

void app.whenReady().then(bootstrap).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (mainWindow !== null) void showFailure(message)
  else app.quit()
})
