import type { BrowserWindowConstructorOptions } from 'electron'

export function desktopWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    title: 'Convax Comic',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#111318',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
}
