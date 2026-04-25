/**
 * Sound Player Preload — IPC bridge for the hidden audio BrowserWindow.
 *
 * Exposes a controlled API via contextBridge for the audio player HTML
 * to communicate with the main process SoundEngine.
 *
 * Communication:
 *   Main → Renderer:  webContents.send('sound:play-buffer', filePath, buffer, volume)
 *   Main → Renderer:  webContents.send('sound:set-volume', volume)
 *   Main → Renderer:  webContents.send('sound:clear-cache')
 *   Renderer → Main:   ipcRenderer.send('sound:ready')
 *   Renderer → Main:   ipcRenderer.send('sound:error', message)
 *
 * Security: Only the specific sound API methods are exposed. No arbitrary
 * IPC or Node.js access is provided to the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Main → Renderer: Play audio from an ArrayBuffer
  onPlayBuffer: (callback: (filePath: string, buffer: ArrayBuffer, volume: number) => void) => {
    ipcRenderer.on('sound:play-buffer', (_event, filePath: string, buffer: ArrayBuffer, volume: number) => {
      callback(filePath, buffer, volume)
    })
  },

  // Main → Renderer: Play sound by file path (legacy — main process sends buffers instead)
  onPlayCommand: (callback: (filePath: string, volume: number) => void) => {
    ipcRenderer.on('sound:play', (_event, filePath: string, volume: number) => {
      callback(filePath, volume)
    })
  },

  // Main → Renderer: Set master volume
  onSetVolume: (callback: (volume: number) => void) => {
    ipcRenderer.on('sound:set-volume', (_event, volume: number) => {
      callback(volume)
    })
  },

  // Main → Renderer: Clear audio cache
  onClearCache: (callback: () => void) => {
    ipcRenderer.on('sound:clear-cache', () => {
      callback()
    })
  },

  // Renderer → Main: Signal ready
  signalReady: () => {
    ipcRenderer.send('sound:ready')
  },

  // Renderer → Main: Report playback ended
  onPlayEnded: (callback: (filePath: string) => void) => {
    ;(window as any).__onPlayEnded = callback
  },

  // Renderer → Main: Report error
  onPlayError: (callback: (errorMsg: string) => void) => {
    ;(window as any).__onPlayError = callback
  },

  // Renderer → Main: Send error message
  reportError: (errorMsg: string) => {
    ipcRenderer.send('sound:error', errorMsg)
  },
})