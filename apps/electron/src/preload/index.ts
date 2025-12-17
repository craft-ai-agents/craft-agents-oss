import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type SessionEvent, type ElectronAPI, type FileAttachment } from '../shared/types'

const api: ElectronAPI = {
  // Session management
  getSessions: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSIONS),
  createSession: (workspaceId: string, agentId?: string, agentName?: string) => ipcRenderer.invoke(IPC_CHANNELS.CREATE_SESSION, workspaceId, agentId, agentName),
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SESSION, sessionId),
  renameSession: (sessionId: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.RENAME_SESSION, sessionId, name),
  sendMessage: (sessionId: string, message: string, attachments?: FileAttachment[]) => ipcRenderer.invoke(IPC_CHANNELS.SEND_MESSAGE, sessionId, message, attachments),
  cancelProcessing: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_PROCESSING, sessionId),
  archiveSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_SESSION, sessionId),
  unarchiveSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.UNARCHIVE_SESSION, sessionId),

  // Workspace management
  getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKSPACES),

  // Agent management
  getAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_AGENTS, workspaceId),
  refreshAgents: (workspaceId: string) => ipcRenderer.invoke(IPC_CHANNELS.REFRESH_AGENTS, workspaceId),
  checkAgentAuth: (workspaceId: string, agentId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHECK_AGENT_AUTH, workspaceId, agentId),

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
  openFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE_DIALOG),
  readFileAttachment: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE_ATTACHMENT, path),
  storeAttachment: (sessionId: string, attachment: FileAttachment) => ipcRenderer.invoke(IPC_CHANNELS.STORE_ATTACHMENT, sessionId, attachment),

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
  }),

  // Shell operations
  openUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_URL, url),
  openFile: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_FILE, path),
}

contextBridge.exposeInMainWorld('electronAPI', api)
