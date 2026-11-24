import { beforeEach, describe, expect, it, mock } from 'bun:test'

// Isolated: replaces the electron and @craft-agent/shared/config modules for this file only.
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
let stored: number | undefined
let focused: ReturnType<typeof fakeWindow> | null = null

function fakeWindow() {
  const contents = { setZoomFactor: mock((_factor: number) => {}), isDestroyed: () => false }
  return { webContents: contents }
}

mock.module('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, fn) },
  BrowserWindow: { getFocusedWindow: () => focused },
}))
mock.module('@craft-agent/shared/config', () => ({
  getPersistedDefaultZoomLevel: () => stored,
  setPersistedDefaultZoomLevel: (level: number) => { stored = level },
}))

const { registerDefaultZoomIpc, resetZoomOfFocusedWindow } = await import('../zoom')

describe('default zoom', () => {
  const windows = [fakeWindow(), fakeWindow()]

  beforeEach(() => {
    handlers.clear()
    stored = undefined
    focused = null
    for (const w of windows) w.webContents.setZoomFactor.mockClear()
    registerDefaultZoomIpc(() => windows as never)
  })

  it('reads 100% when nothing is stored, and snaps a stored odd value', async () => {
    expect(await handlers.get('zoom:getDefault')!({})).toBe(100)
    stored = 118
    expect(await handlers.get('zoom:getDefault')!({})).toBe(125)
  })

  it('stores the snapped level and zooms every app window', async () => {
    expect(await handlers.get('zoom:setDefault')!({}, 112)).toBe(110)
    expect(stored).toBe(110)
    for (const w of windows) expect(w.webContents.setZoomFactor).toHaveBeenCalledWith(1.1)
  })

  it('Reset Zoom returns the focused window to the default, not 100%', () => {
    stored = 125
    focused = windows[0]!
    resetZoomOfFocusedWindow()
    expect(windows[0]!.webContents.setZoomFactor).toHaveBeenCalledWith(1.25)
    expect(windows[1]!.webContents.setZoomFactor).not.toHaveBeenCalled()
  })
})
