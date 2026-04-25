/**
 * Sound Player Preload — IPC bridge for the hidden audio BrowserWindow.
 *
 * Exposes a controlled API via contextBridge for the audio player HTML
 * to communicate with the main process SoundEngine.
 *
 * Communication:
 *   Main → Renderer:  webContents.send('sound:play', uint8Array, volume, ext)
 *   Main → Renderer:  webContents.send('sound:set-volume', volume)
 *   Renderer → Main:   ipcRenderer.send('sound:ready')
 *   Renderer → Main:   ipcRenderer.send('sound:player-error', message)
 *
 * Security: Only the specific sound API methods are exposed. No arbitrary
 * IPC or Node.js access is provided to the renderer.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Main → Renderer: Play audio from Uint8Array data
  onPlay: (callback: (data: Uint8Array, volume: number, ext: string) => void) => {
    ipcRenderer.on('sound:play', (_event, data: Uint8Array, volume: number, ext: string) => {
      callback(data, volume, ext)
    })
  },

  // Main → Renderer: Set master volume
  onSetVolume: (callback: (volume: number) => void) => {
    ipcRenderer.on('sound:set-volume', (_event, volume: number) => {
      callback(volume)
    })
  },

  // Renderer → Main: Signal ready
  signalReady: () => {
    ipcRenderer.send('sound:ready')
  },

  // Renderer → Main: Report playback error (so we can log it)
  reportError: (errorMsg: string) => {
    ipcRenderer.send('sound:player-error', errorMsg)
  },
})