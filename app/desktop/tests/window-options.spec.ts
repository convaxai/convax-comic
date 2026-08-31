import { describe, expect, it } from 'vitest'
import { desktopWindowOptions } from '../src/window-options.js'

describe('BrowserWindow security options', () => {
  it('keeps the renderer sandboxed, isolated, and without Node', () => {
    const options = desktopWindowOptions('/app/preload.cjs')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.webPreferences).toMatchObject({
      preload: '/app/preload.cjs',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    })
  })
})
