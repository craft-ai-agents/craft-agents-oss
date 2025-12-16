import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  createSession: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  sendMessage: (sessionId: string, message: string) => ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, sessionId, message),
  cancelProcessing: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROCESSING, sessionId),

  // Workspace management
  getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKSPACES),

  // Event listener
  onSessionEvent: (callback: (event: SessionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionEvent: SessionEvent) => {
      callback(sessionEvent)
    }
    ipcRenderer.on(IPC_CHANNELS.SESSION_EVENT, handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SESSION_EVENT, handler)
    }
  },

  // File operations
  readFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, path),

  // Theme
  getSystemTheme: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SYSTEM_THEME),
  onSystemThemeChange: (callback: (isDark: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, isDark: boolean) => {
      callback(isDark)
    }
    ipcRenderer.on(IPC_CHANNELS.SYSTEM_THEME_CHANGED, handler)
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM_THEME_CHANGED, handler)
    }
  },

  // System
  getVersions: () => ({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  })
}

contextBridge.exposeInMainWorld('electronAPI', api)
