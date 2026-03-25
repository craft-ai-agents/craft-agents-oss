// Load user's shell environment first (before other imports that may use env)
// This ensures tools like Homebrew, nvm, etc. are available to the agent
import { loadShellEnv } from './shell-env'
loadShellEnv()

import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { hostname, homedir } from 'os'
import * as Sentry from '@sentry/electron/main'

// Initialize Sentry error tracking as early as possible after app import.
// Only enabled in production (packaged) builds to avoid noise during development.
// DSN is baked in at build time via esbuild --define (same pattern as OAuth secrets).
//
// NOTE: Source map upload is intentionally disabled. Stack traces in Sentry will show
// bundled/minified code. To enable source map upload in the future:
//   1. Add SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT to CI secrets
//   2. Re-enable the @sentry/vite-plugin in vite.config.ts (handles renderer maps)
//   3. Add @sentry/esbuild-plugin to scripts/electron-build-main.ts (handles main process maps)
Sentry.init({
  dsn: process.env.SENTRY_ELECTRON_INGEST_URL,
  environment: app.isPackaged ? 'production' : 'development',
  release: app.getVersion(),
  // Enabled whenever the ingest URL is available — works in both production (baked via CI)
  // and development (injected via .env / 1Password). Filter by environment in Sentry dashboard.
  enabled: !!process.env.SENTRY_ELECTRON_INGEST_URL,

  // Scrub sensitive data before sending to Sentry.
  // Removes authorization headers, API keys/tokens, and credential-like values.
  beforeSend(event) {
    // Scrub request headers (authorization, cookies)
    if (event.request?.headers) {
      const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key']
      for (const header of sensitiveHeaders) {
        if (event.request.headers[header]) {
          event.request.headers[header] = '[REDACTED]'
        }
      }
    }

    // Scrub breadcrumb data that may contain sensitive values
    if (event.breadcrumbs) {
      for (const breadcrumb of event.breadcrumbs) {
        if (breadcrumb.data) {
          for (const key of Object.keys(breadcrumb.data)) {
            const lowerKey = key.toLowerCase()
            if (lowerKey.includes('token') || lowerKey.includes('key') ||
                lowerKey.includes('secret') || lowerKey.includes('password') ||
                lowerKey.includes('credential') || lowerKey.includes('auth')) {
              breadcrumb.data[key] = '[REDACTED]'
            }
          }
        }
      }
    }

    return event
  },
})

// Set anonymous machine ID for Sentry user tracking (no PII — just a hash).
// Uses hostname + homedir to produce a stable per-machine identifier.
const machineId = createHash('sha256').update(hostname() + homedir()).digest('hex').slice(0, 16)
Sentry.setUser({ id: machineId })

import { join, delimiter } from 'path'
import { existsSync } from 'fs'
import { SessionManager, setSessionPlatform, setSessionRuntimeHooks } from '@craft-agent/server-core/sessions'
import { registerAllRpcHandlers } from './handlers/index'
import { cleanupSessionFileWatchForClient } from '@craft-agent/server-core/handlers/rpc'
import type { PlatformServices } from '../runtime/platform'
import type { HandlerDeps } from './handlers/handler-deps'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { WsRpcServer } from '../transport/server'
import { initModelRefreshService, getModelRefreshService, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers'
import { setSearchPlatform, setImageProcessor } from '@craft-agent/server-core/services'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces, loadStoredConfig, addWorkspace, saveConfig, getStoredRemoteServerProfiles } from '@craft-agent/shared/config'
import { getDefaultWorkspacesDir, isRemoteWorkspaceTargetId } from '@craft-agent/shared/workspaces'
import { initializeDocs } from '@craft-agent/shared/docs'
import { initializeReleaseNotes } from '@craft-agent/shared/release-notes'
import { ensureDefaultPermissions } from '@craft-agent/shared/agent/permissions-config'
import { ensureToolIcons, ensurePresetThemes } from '@craft-agent/shared/config'
import { setBundledAssetsRoot } from '@craft-agent/shared/utils'
import { initializeBackendHostRuntime } from '@craft-agent/shared/agent/backend'
import { setPowerShellValidatorRoot } from '@craft-agent/shared/agent'
import { handleDeepLink } from './deep-link'
import { BrowserPaneManager } from './browser-pane-manager'
import { OAuthFlowStore } from '@craft-agent/shared/auth'
import { registerThumbnailScheme, registerThumbnailHandler } from './thumbnail-protocol'
import log, { isDebugMode, mainLog, getLogFilePath } from './logger'
import { setPerfEnabled, enableDebug } from '@craft-agent/shared/utils'
import { registerPiModelResolver } from '@craft-agent/shared/config'
import { getPiModelsForAuthProvider, getAllPiModels } from '@craft-agent/shared/config'
import { initNotificationService, initBadgeIcon, initInstanceBadge, updateBadgeCount } from './notifications'
import { checkForUpdatesOnLaunch, setAutoUpdateEventSink, isUpdating } from './auto-update'
import type { EventSink } from '@craft-agent/server-core/transport'
import { validateGitBashPath, checkVCRedistInstalled } from '@craft-agent/server-core/services'

// Initialize electron-log for renderer process support
log.initialize()

// Enable debug/perf in dev mode (running from source)
if (isDebugMode) {
  process.env.CRAFT_DEBUG = '1'
  enableDebug()
  setPerfEnabled(true)
}

// Bundle CLI tools: resolve platform-specific uv binary and wrapper scripts.
// These are available to all agent Bash sessions via CRAFT_UV, CRAFT_SCRIPTS env vars
// and PATH prepend. uv auto-downloads Python 3.12 on first use (~5s, then cached).
{
  // In packaged app: resources are at process.resourcesPath/app/resources/
  // In dev: resources are at __dirname/../resources/ (sibling of dist/)
  const resourcesBase = app.isPackaged
    ? join(process.resourcesPath, 'app')
    : join(__dirname, '..')
  const platformKey = `${process.platform}-${process.arch}`
  const uvPlatformDir = join(resourcesBase, 'resources', 'bin', platformKey)
  const uvBinary = join(uvPlatformDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  const binDir = join(resourcesBase, 'resources', 'bin')
  const scriptsDir = join(resourcesBase, 'resources', 'scripts')

  const bundledUvExists = existsSync(uvBinary)
  const fallbackUv = bundledUvExists ? null : 'uv'

  // Runtime resolver hints for shared session tools
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? '1' : '0'
  process.env.CRAFT_RESOURCES_BASE = resourcesBase
  process.env.CRAFT_APP_ROOT = app.isPackaged ? app.getAppPath() : process.cwd()

  process.env.CRAFT_UV = bundledUvExists ? uvBinary : (fallbackUv ?? uvBinary)

  // Bun runtime (packaged builds should prefer bundled runtime over PATH)
  const bunBinary = join(resourcesBase, 'vendor', 'bun', process.platform === 'win32' ? 'bun.exe' : 'bun')
  if (existsSync(bunBinary)) {
    process.env.CRAFT_BUN = bunBinary
  }

  process.env.CRAFT_SCRIPTS = scriptsDir
  process.env.CRAFT_COMMANDS_ENTRY = app.isPackaged
    ? join(app.getAppPath(), 'packages', 'craft-agents-commands', 'src', 'main.ts')
    : join(process.cwd(), 'packages', 'craft-agents-commands', 'src', 'main.ts')
  process.env.CRAFT_CLI_ENTRY = app.isPackaged
    ? join(app.getAppPath(), 'packages', 'craft-cli', 'src', 'cli.ts')
    : join(process.cwd(), 'packages', 'craft-cli', 'src', 'cli.ts')
  process.env.CRAFT_COMMANDS_DOC_PATH = app.isPackaged
    ? join(resourcesBase, 'resources', 'docs', 'craft-cli.md')
    : join(process.cwd(), 'apps', 'electron', 'resources', 'docs', 'craft-cli.md')
  process.env.CRAFT_CLI_DOC_PATH = process.env.CRAFT_COMMANDS_DOC_PATH
  process.env.CRAFT_AGENT_VERSION = app.getVersion()
  // Prepend both generic wrappers dir and platform uv dir:
  // - binDir exposes wrapper commands (pdf-tool, docx-tool, ...)
  // - uvPlatformDir exposes raw `uv` for direct shell usage / debugging
  process.env.PATH = `${binDir}${delimiter}${uvPlatformDir}${delimiter}${process.env.PATH}`

  if (!bundledUvExists) {
    mainLog.warn('Bundled uv binary missing, CLI document tools may fail unless uv is available on PATH.', {
      expectedUvPath: uvBinary,
      usingCraftUv: process.env.CRAFT_UV,
    })
  }

  if (isDebugMode) {
    mainLog.info('CLI tools configured:', { uvBinary: process.env.CRAFT_UV, binDir, scriptsDir, bundledUvExists })
  }
}

// Register Pi model resolver so llm-connections.ts can resolve Pi models
// without importing @mariozechner/pi-ai (which breaks the Vite renderer build)
registerPiModelResolver((piAuthProvider) =>
  piAuthProvider ? getPiModelsForAuthProvider(piAuthProvider) : getAllPiModels()
)

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
// Supports multi-instance dev: CRAFT_DEEPLINK_SCHEME env var (craftagents1, craftagents2, etc.)
const DEEPLINK_SCHEME = process.env.CRAFT_DEEPLINK_SCHEME || 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null
let browserPaneManager: BrowserPaneManager | null = null
let oauthFlowStore: OAuthFlowStore | null = null
let moduleSink: EventSink | null = null
let moduleClientResolver: ((webContentsId: number) => string | undefined) | null = null

// Store pending deep link if app not ready yet (cold start)
let pendingDeepLink: string | null = null

// Set app name early (before app.whenReady) to ensure correct macOS menu bar title.
// In packaged builds, prefer the bundle/product name so forked apps get their own
// menu title and user data path instead of colliding with the official app.
const detectedAppName = app.getName()
const defaultAppName = app.isPackaged && detectedAppName && detectedAppName !== '@craft-agent/electron'
  ? detectedAppName
  : 'Craft Agents'
// Supports multi-instance dev: CRAFT_APP_NAME env var (e.g., "Craft Agents [1]")
app.setName(process.env.CRAFT_APP_NAME || defaultAppName)

// Register as default protocol client for craftagents:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Apply network proxy settings early (Node-level only — Electron sessions require app.whenReady)
import { applyConfiguredProxySettings } from './network-proxy'
void applyConfiguredProxySettings()

// Accept self-signed / untrusted certificates when connecting to configured remote servers.
// Only bypasses cert validation for exact origins that are either:
// - the direct thin-client target from CRAFT_SERVER_URL, or
// - saved remote server profiles from config.
// All other connections use standard certificate verification. Without this,
// wss:// to self-signed/private-CA servers fails with ERR_CERT_AUTHORITY_INVALID
// because Chromium's WebSocket rejects untrusted certs.
//
// Electron's certificate-error always reports URLs with https:// scheme, so we normalize
// wss:// → https:// (and ws:// → http://) to ensure origins compare correctly.
function normalizeOriginForCert(urlStr: string): string {
  const u = new URL(urlStr)
  if (u.protocol === 'wss:') u.protocol = 'https:'
  else if (u.protocol === 'ws:') u.protocol = 'http:'
  return u.origin
}

function getTrustedRemoteServerOrigins(): Set<string> {
  const origins = new Set<string>()

  try {
    if (process.env.CRAFT_SERVER_URL) {
      origins.add(normalizeOriginForCert(process.env.CRAFT_SERVER_URL))
    }
  } catch {
    // Invalid direct URL — will fail later during connection.
  }

  for (const profile of getStoredRemoteServerProfiles()) {
    try {
      origins.add(normalizeOriginForCert(profile.url))
    } catch {
      // Ignore malformed stored profile URLs here; connection code will surface them elsewhere.
    }
  }

  return origins
}

app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  try {
    const origin = normalizeOriginForCert(url)
    if (getTrustedRemoteServerOrigins().has(origin)) {
      event.preventDefault()
      callback(true)
      return
    }
  } catch {
    // URL parse failure — fall through to default rejection
  }
  callback(false)
})

// Register thumbnail:// custom protocol for file preview thumbnails in the sidebar.
// Must happen before app.whenReady() — Electron requires early scheme registration.
registerThumbnailScheme()

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  mainLog.info('Received deeplink:', url)

  if (windowManager) {
    handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
      mainLog.error('Failed to handle deep link:', err)
    })
  } else {
    // App not ready - store for later
    pendingDeepLink = url
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url && windowManager) {
      mainLog.info('Received deeplink from second instance:', url)
      handleDeepLink(url, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined).catch(err => {
        mainLog.error('Failed to handle deep link:', err)
      })
    } else if (windowManager) {
      // No deep link - just focus the first window
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  let workspaces = getWorkspaces()

  // If no workspaces exist, create default "My Workspace" on first run
  if (workspaces.length === 0) {
    // Ensure config file exists (addWorkspace requires it)
    if (!loadStoredConfig()) {
      saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
    }
    const defaultPath = join(getDefaultWorkspacesDir(), 'my-workspace')
    addWorkspace({ rootPath: defaultPath, name: 'My Workspace' })
    workspaces = getWorkspaces() // Refresh after creation
    mainLog.info('Created default workspace on first run')
  }

  const validWorkspaceIds = workspaces.map(ws => ws.id)

  if (savedState?.windows.length) {
    // Restore windows from saved state
    let restoredCount = 0

    for (const saved of savedState.windows) {
      // Skip invalid local workspaces. Remote targets are restored optimistically
      // because availability depends on per-window remote connections in preload.
      if (!isRemoteWorkspaceTargetId(saved.workspaceId) && !validWorkspaceIds.includes(saved.workspaceId)) continue

      // Restore main window with focused mode if it was saved
      mainLog.info(`Restoring window: workspaceId=${saved.workspaceId}, focused=${saved.focused ?? false}, url=${saved.url ?? 'none'}`)
      const win = windowManager.createWindow({
        workspaceId: saved.workspaceId,
        focused: saved.focused,
        restoreUrl: saved.url,
      })
      win.setBounds(saved.bounds)

      restoredCount++
    }

    if (restoredCount > 0) {
      mainLog.info(`Restored ${restoredCount} window(s) from saved state`)
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow({ workspaceId: workspaces[0].id })
  mainLog.info(`Created window for first workspace: ${workspaces[0].name}`)
}

app.whenReady().then(async () => {
  // Export packaged state as env var so logger.ts (and headless Bun) don't need 'electron'
  process.env.CRAFT_IS_PACKAGED = app.isPackaged ? 'true' : 'false'

  // Register bundled assets root so all seeding functions can find their files
  // (docs, permissions, themes, tool-icons resolve via getBundledAssetsDir)
  setBundledAssetsRoot(__dirname)

  // Initialize backend runtime bootstrapping (Codex vendor root, Claude SDK runtime paths).
  initializeBackendHostRuntime({
    hostRuntime: {
      appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
    },
  })

  // Register PowerShell validator root so it can find the bundled parser script
  // (Windows only: validates PowerShell commands in Explore mode using AST analysis)
  setPowerShellValidatorRoot(join(__dirname, 'resources'))

  // Initialize bundled docs
  initializeDocs()

  // Initialize bundled release notes
  initializeReleaseNotes()

  // Ensure default permissions file exists (copies bundled default.json on first run)
  ensureDefaultPermissions()

  // Seed tool icons to ~/.craft-agent/tool-icons/ (copies bundled SVGs on first run)
  ensureToolIcons()

  // Seed preset themes to ~/.craft-agent/themes/ (copies bundled theme JSONs on first run)
  ensurePresetThemes()

  // Register thumbnail:// protocol handler (scheme was registered earlier, before app.whenReady)
  registerThumbnailHandler()

  // Re-apply proxy settings now that Electron sessions are available
  // (first call before app.whenReady only configured Node-level proxy)
  await applyConfiguredProxySettings()

  // Note: electron-updater handles pending updates internally via autoInstallOnAppQuit

  // Application menu is created after windowManager initialization (see below)

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    // In packaged app, resources are at dist/resources/ (same level as __dirname)
    // In dev, resources are at ../resources/ (sibling of dist/)
    const dockIconPath = [
      join(__dirname, 'resources/icon.png'),
      join(__dirname, '../resources/icon.png'),
    ].find(p => existsSync(p))

    if (dockIconPath) {
      app.dock.setIcon(dockIconPath)
      // Initialize badge icon for canvas-based badge overlay
      initBadgeIcon(dockIconPath)
    }

    // Multi-instance dev: show instance number badge on dock icon
    // CRAFT_INSTANCE_NUMBER is set by detect-instance.sh for numbered folders
    const instanceNum = process.env.CRAFT_INSTANCE_NUMBER
    if (instanceNum) {
      const num = parseInt(instanceNum, 10)
      if (!isNaN(num) && num > 0) {
        initInstanceBadge(num)
      }
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Create the application menu (needs windowManager for New Window action)
    createApplicationMenu(windowManager)

    // When CRAFT_SERVER_URL is set, this Electron instance is a thin client —
    // it only creates windows whose preload connects to the remote server.
    // Skip server-side initialization (SessionManager, model refresh, platform injection).
    const isClientOnly = !!process.env.CRAFT_SERVER_URL
    const isHeadless = !!process.env.CRAFT_HEADLESS

    if (isClientOnly) {
      mainLog.info(`Client-only mode: CRAFT_SERVER_URL=${process.env.CRAFT_SERVER_URL} (server initialization skipped)`)
    }

    // Initialize session manager (server-side only — thin client delegates to remote server)
    let modelRefreshService: ReturnType<typeof initModelRefreshService> | null = null
    if (!isClientOnly) {
      sessionManager = new SessionManager()

      // Restore persisted Git Bash path on Windows (must happen before any SDK subprocess spawn)
      if (process.platform === 'win32') {
        const { getGitBashPath, clearGitBashPath } = await import('@craft-agent/shared/config')
        const gitBashPath = getGitBashPath()
        if (gitBashPath) {
          const validation = await validateGitBashPath(gitBashPath)
          if (validation.valid) {
            process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
          } else {
            clearGitBashPath()
            delete process.env.CLAUDE_CODE_GIT_BASH_PATH
            mainLog.warn(`Cleared invalid persisted Git Bash path: ${gitBashPath}`)
          }
        }
      }

      // Check for VC++ Redistributable on Windows (required by onnxruntime / markitdown).
      // Without it, document conversion tools (PDF, PPTX, DOCX, XLSX) crash with DLL errors.
      // Sets env var so renderer can show an actionable toast with install button.
      if (process.platform === 'win32') {
        const vcCheck = checkVCRedistInstalled()
        if (!vcCheck.installed) {
          mainLog.warn('[vcredist]', vcCheck.message)
          process.env.CRAFT_VCREDIST_MISSING = '1'
          if (vcCheck.downloadUrl) {
            process.env.CRAFT_VCREDIST_URL = vcCheck.downloadUrl
          }
        } else if (isDebugMode) {
          mainLog.info('[vcredist]', vcCheck.message)
        }
      }

      // Initialize model refresh service BEFORE IPC handlers —
      // getModelRefreshService() is called from IPC handlers, so it must be ready
      // before any renderer can send messages.
      modelRefreshService = initModelRefreshService(async (slug: string) => {
        const { getCredentialManager } = await import('@craft-agent/shared/credentials')
        const manager = getCredentialManager()
        const [apiKey, oauth] = await Promise.all([
          manager.getLlmApiKey(slug).catch(() => null),
          manager.getLlmOAuth(slug).catch(() => null),
        ])
        return {
          apiKey: apiKey ?? undefined,
          oauthAccessToken: oauth?.accessToken,
          oauthRefreshToken: oauth?.refreshToken,
          oauthIdToken: oauth?.idToken,
        }
      })
    }

    // Initialize notification service (always — triggered by server push events)
    initNotificationService(windowManager)

    // Initialize browser pane manager
    browserPaneManager = new BrowserPaneManager()
    browserPaneManager.setWindowManager(windowManager)
    browserPaneManager.registerToolbarIpc()
    sessionManager?.setBrowserPaneManager(browserPaneManager)

    // Build real PlatformServices from Electron APIs
    const platform: PlatformServices = {
      appRootPath: app.isPackaged ? app.getAppPath() : process.cwd(),
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion(),
      openExternal: (url) => shell.openExternal(url),
      openPath: (p) => shell.openPath(p).then(() => {}),
      showItemInFolder: (p) => shell.showItemInFolder(p),
      quit: () => app.quit(),
      systemDarkMode: () => nativeTheme.shouldUseDarkColors,
      imageProcessor: {
        async getMetadata(buffer) {
          const img = nativeImage.createFromBuffer(buffer)
          if (img.isEmpty()) return null
          const { width, height } = img.getSize()
          return (width && height) ? { width, height } : null
        },
        async process(input, opts = {}) {
          const img = typeof input === 'string'
            ? nativeImage.createFromPath(input)
            : nativeImage.createFromBuffer(input)
          if (img.isEmpty()) throw new Error('Invalid image input')

          let result = img
          if (opts.resize) {
            const { width: tw, height: th } = opts.resize
            const fit = opts.fit ?? 'inside'
            if (fit === 'inside') {
              const { width: sw, height: sh } = result.getSize()
              const scale = Math.min(tw / sw, th / sh, 1)
              result = result.resize({
                width: Math.round(sw * scale),
                height: Math.round(sh * scale),
              })
            } else {
              result = result.resize({ width: tw, height: th })
            }
          }
          return (opts.format === 'jpeg')
            ? result.toJPEG(opts.quality ?? 90)
            : result.toPNG()
        },
      },
      logger: log,
      isDebugMode,
      getLogFilePath,
      captureError: (err) => Sentry.captureException(err),
    }

    // Inject platform into server-side subsystems (skip in thin-client mode)
    if (!isClientOnly) {
      setFetcherPlatform(platform)
      setSessionPlatform(platform)
      const { onSessionStarted, onSessionStopped } = await import('./power-manager')
      setSessionRuntimeHooks({
        updateBadgeCount,
        onSessionStarted,
        onSessionStopped,
        captureException: (error, context) => {
          Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
            tags: {
              ...(context?.errorSource ? { errorSource: context.errorSource } : {}),
              ...(context?.sessionId ? { sessionId: context.sessionId } : {}),
            },
          })
        },
      })
      setSearchPlatform(platform)
      setImageProcessor(platform.imageProcessor)
    }

    // Bootstrap IPC handlers — preload uses sendSync for window-local details
    ipcMain.on('__get-web-contents-id', (e) => {
      e.returnValue = e.sender.id
    })
    ipcMain.on('__get-workspace-id', (e) => {
      e.returnValue = windowManager?.getWorkspaceForWindow(e.sender.id) ?? ''
    })

    // Transport diagnostics bridge — preload reports remote WS connection state changes
    // so failures are visible in terminal/main.log (not only renderer console).
    ipcMain.on('__transport:status', (_event, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as {
        level?: 'info' | 'warn' | 'error'
        message?: string
        status?: string
        attempt?: number
        nextRetryInMs?: number
        error?: unknown
        close?: unknown
        url?: string
      }

      const level = p.level ?? 'info'
      const message = p.message ?? '[transport] status update'
      const context = {
        status: p.status,
        attempt: p.attempt,
        nextRetryInMs: p.nextRetryInMs,
        error: p.error,
        close: p.close,
        url: p.url,
      }

      if (level === 'error') {
        mainLog.error(message, context)
      } else if (level === 'warn') {
        mainLog.warn(message, context)
      } else {
        mainLog.info(message, context)
      }
    })

    // Dialog bridge — preload capability handlers use ipcRenderer.invoke to
    // call main-process-only dialog APIs (dialog, BrowserWindow).
    ipcMain.handle('__dialog:showMessageBox', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showMessageBox(win, spec)
      return { response: result.response }
    })
    ipcMain.handle('__dialog:showOpenDialog', async (event, spec) => {
      const win = BrowserWindow.fromWebContents(event.sender)
        || BrowserWindow.getFocusedWindow()
        || BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, spec)
      return { canceled: result.canceled, filePaths: result.filePaths }
    })

    if (!isClientOnly) {
      // Create WS RPC server (local WebSocket transport)
      // CRAFT_RPC_HOST / CRAFT_RPC_PORT allow binding to a custom address for remote access.
      const rpcHost = process.env.CRAFT_RPC_HOST ?? '127.0.0.1'
      const rpcPort = process.env.CRAFT_RPC_PORT ? parseInt(process.env.CRAFT_RPC_PORT, 10) : 0

      const clientMap = new Map<number, string>()
      const resolveClientId = (wcId: number) => clientMap.get(wcId)
      const localToken = randomUUID()

      const wsServer = new WsRpcServer({
        host: rpcHost,
        port: rpcPort,
        requireAuth: true,
        validateToken: async (t) => t === localToken,
        serverId: 'local',
        onClientConnected: ({ clientId, webContentsId }) => {
          if (webContentsId != null) clientMap.set(webContentsId, clientId)
        },
        onClientDisconnected: (clientId) => {
          for (const [wcId, cId] of clientMap) {
            if (cId === clientId) { clientMap.delete(wcId); break }
          }
          cleanupSessionFileWatchForClient(clientId)
        },
      })
      await wsServer.listen()
      const server: RpcServer = wsServer
      mainLog.info(`WS RPC server listening on ${rpcHost}:${wsServer.port}`)

      // In headless mode, print connection details so a remote client can connect
      if (isHeadless) {
        console.log(`CRAFT_SERVER_URL=ws://${rpcHost}:${wsServer.port}`)
        console.log(`CRAFT_SERVER_TOKEN=${localToken}`)
      }

      // Module-level EventSink/client resolver — used by deep-link handlers defined before app.whenReady
      moduleSink = server.push.bind(server)
      moduleClientResolver = resolveClientId

      // Bootstrap IPC handlers — preload uses sendSync to get WS connection details
      ipcMain.on('__get-ws-port', (e) => {
        e.returnValue = wsServer.port
      })
      ipcMain.on('__get-ws-token', (e) => {
        e.returnValue = localToken
      })

      oauthFlowStore = new OAuthFlowStore()

      // Ensure global config.json exists before handlers can be called.
      // In GUI mode, createInitialWindows() also ensures this, but in headless
      // mode that function is skipped — so we must do it here.
      if (!loadStoredConfig()) {
        saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
        mainLog.info('Initialized missing global config')
      }

      const deps: HandlerDeps = {
        sessionManager: sessionManager!,
        platform,
        windowManager,
        browserPaneManager,
        oauthFlowStore,
      }

      // Register RPC handlers (must happen before window creation)
      registerAllRpcHandlers(server, deps)

      // Wire EventSink so SessionManager pushes events via the RPC server
      sessionManager!.setEventSink(server.push.bind(server))

      // Wire EventSink to services that broadcast events to renderers
      // Must happen BEFORE createInitialWindows() so event handlers use WS from the start
      windowManager.setRpcEventSink(moduleSink!, resolveClientId)
      const { setMenuEventSink } = await import('./menu')
      setMenuEventSink(moduleSink!, resolveClientId)
      const { setNotificationEventSink } = await import('./notifications')
      setNotificationEventSink(moduleSink!, resolveClientId)

      // Initialize auth (must happen after window creation for error reporting)
      await sessionManager!.initialize()

      // Start periodic model refresh after auth is initialized
      modelRefreshService!.startAll()
    }

    // Create initial windows (restores from saved state or opens first workspace)
    // In headless mode the server runs without any UI — skip window creation.
    if (!isHeadless) {
      await createInitialWindows()
    }

    // Run credential health check at startup to detect issues early
    // (corruption, machine migration, missing credentials for default connection)
    // Skip in thin-client mode — credentials are managed by the remote server.
    if (!isClientOnly) {
      try {
        const { getCredentialManager } = await import('@craft-agent/shared/credentials')
        const credentialManager = getCredentialManager()
        const health = await credentialManager.checkHealth()
        if (!health.healthy) {
          mainLog.warn('Credential health check failed:', health.issues)
          // Issues will be displayed in Settings → AI when user navigates there
        }
      } catch (err) {
        mainLog.error('Credential health check error:', err)
      }
    }

    // Initialize power manager (loads setting, must happen after config is available)
    // Non-critical — powerSaveBlocker may not work on headless/xvfb setups
    try {
      const { initPowerManager } = await import('./power-manager')
      await initPowerManager()
    } catch (err) {
      mainLog.warn('[power] Power manager init failed (non-critical):', err instanceof Error ? err.message : err)
    }

    // Set Sentry context tags for error grouping (no PII — just config classification).
    // Runs after init so config and auth state are available.
    // Derives values from the default LLM connection instead of legacy config fields.
    try {
      const { getLlmConnection, getDefaultLlmConnection } = await import('@craft-agent/shared/config')
      const workspaces = getWorkspaces()
      const defaultConnSlug = getDefaultLlmConnection()
      const defaultConn = defaultConnSlug ? getLlmConnection(defaultConnSlug) : null
      Sentry.setTag('authType', defaultConn?.authType ?? 'unknown')
      Sentry.setTag('providerType', defaultConn?.providerType ?? 'unknown')
      Sentry.setTag('hasCustomEndpoint', String(!!defaultConn?.baseUrl))
      Sentry.setTag('model', defaultConn?.defaultModel ?? 'default')
      Sentry.setTag('workspaceCount', String(workspaces.length))
    } catch (err) {
      mainLog.warn('Failed to set Sentry context tags:', err)
    }

    // Initialize auto-update (check immediately on launch)
    // Skip in dev mode to avoid replacing /Applications app and launching it instead
    if (moduleSink) setAutoUpdateEventSink(moduleSink)
    if (app.isPackaged) {
      checkForUpdatesOnLaunch().catch(err => {
        mainLog.error('[auto-update] Launch check failed:', err)
      })
    } else {
      mainLog.info('[auto-update] Skipping auto-update in dev mode')
    }

    // Process pending deep link from cold start
    if (pendingDeepLink) {
      mainLog.info('Processing pending deep link:', pendingDeepLink)
      await handleDeepLink(pendingDeepLink, windowManager, moduleSink ?? undefined, moduleClientResolver ?? undefined)
      pendingDeepLink = null
    }

    mainLog.info('App initialized successfully')
    if (isDebugMode) {
      mainLog.info('Debug mode enabled - logs at:', getLogFilePath())
    }
  } catch (error) {
    mainLog.error('Failed to initialize app:', error instanceof Error ? error.message : error, (error as any)?.stack)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowManager) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow({ workspaceId: wsId })
        } else {
          windowManager.createWindow({ workspaceId: workspaces[0].id })
        }
      }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.env.CRAFT_HEADLESS) return  // headless server stays alive
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Track if we're in the process of quitting (to avoid re-entry)
let isQuitting = false

// Save window state and clean up resources before quitting
app.on('before-quit', async (event) => {
  // Avoid re-entry when we call app.exit()
  if (isQuitting) return
  isQuitting = true

  // Ensure Cmd+Q/app quit bypasses layered window close interception (Cmd+W behavior).
  windowManager?.setAppQuitting(true)

  if (windowManager) {
    // Get full window states (includes bounds, type, and query)
    const windows = windowManager.getWindowStates()
    // Get the focused window's workspace as last focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    let lastFocusedWorkspaceId: string | undefined
    if (focusedWindow) {
      lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    }

    saveWindowState({
      windows,
      lastFocusedWorkspaceId,
    })
    mainLog.info('Saved window state:', windows.length, 'windows')
  }

  // Flush all pending session writes before quitting
  if (sessionManager) {
    // Prevent quit until sessions are flushed
    event.preventDefault()
    try {
      await sessionManager.flushAllSessions()
      mainLog.info('Flushed all pending session writes')
    } catch (error) {
      mainLog.error('Failed to flush sessions:', error)
    }
    // Clean up SessionManager resources (file watchers, timers, etc.)
    sessionManager.cleanup()

    // Clean up browser pane instances
    if (browserPaneManager) {
      browserPaneManager.destroyAll()
    }

    // Clean up OAuth flow store (stop periodic cleanup timer)
    if (oauthFlowStore) {
      oauthFlowStore.dispose()
    }

    // Stop all model refresh timers
    getModelRefreshService().stopAll()

    // Clean up power manager (release power blocker)
    const { cleanup: cleanupPowerManager } = await import('./power-manager')
    cleanupPowerManager()

    // If update is in progress, let electron-updater handle the quit flow
    // Force exit breaks the NSIS installer on Windows
    if (isUpdating()) {
      mainLog.info('Update in progress, letting electron-updater handle quit')
      app.quit()
      return
    }

    // Now actually quit
    app.exit(0)
  }
})

// Handle uncaught exceptions — forward to Sentry explicitly since registering
// a custom handler can interfere with @sentry/electron's automatic capture.
process.on('uncaughtException', (error) => {
  mainLog.error('Uncaught exception:', error)
  Sentry.captureException(error)
})

process.on('unhandledRejection', (reason, promise) => {
  mainLog.error('Unhandled rejection at:', promise, 'reason:', reason)
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)))
})
