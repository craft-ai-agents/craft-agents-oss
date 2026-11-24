import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { getPersistedDefaultZoomLevel, setPersistedDefaultZoomLevel } from '@craft-agent/shared/config'
import { normalizeZoomLevel } from '../shared/zoom'

/**
 * Default zoom for app windows (Settings → Appearance → Default zoom). The main process is the
 * only place that applies it: after every load of an app window (Chromium resets zoom when a
 * load commits), when the setting changes, and on View → Reset Zoom. The value is a per-device
 * preference (preferences.json), read and written over direct IPC, so it works the same in
 * thin-client mode and never reaches a remote server.
 */
export function getDefaultZoomLevel(): number {
  return normalizeZoomLevel(getPersistedDefaultZoomLevel())
}

export function applyDefaultZoom(contents: WebContents): void {
  if (!contents.isDestroyed()) contents.setZoomFactor(getDefaultZoomLevel() / 100)
}

/** View → Reset Zoom: back to the default zoom, not 100%. */
export function resetZoomOfFocusedWindow(): void {
  const window = BrowserWindow.getFocusedWindow()
  if (window) applyDefaultZoom(window.webContents)
}

/** `zoom:getDefault` / `zoom:setDefault` for the Appearance page. */
export function registerDefaultZoomIpc(appWindows: () => BrowserWindow[]): void {
  ipcMain.handle('zoom:getDefault', () => getDefaultZoomLevel())
  ipcMain.handle('zoom:setDefault', (_event, level: unknown) => {
    const normalized = normalizeZoomLevel(level)
    setPersistedDefaultZoomLevel(normalized)
    for (const window of appWindows()) applyDefaultZoom(window.webContents)
    return normalized
  })
}
