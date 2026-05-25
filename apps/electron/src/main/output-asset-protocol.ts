import { protocol, session, type Session } from 'electron'
import { readFile, stat } from 'fs/promises'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { assertOutputAssetPath, parseRunnerOutputAssetUrl, RUNNER_OUTPUT_SCHEME } from '@craft-agent/shared/outputs'
import { mainLog } from './logger'
import { BROWSER_PANE_SESSION_PARTITION } from './browser-pane-constants'

const HTML_PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  `connect-src 'self' ${RUNNER_OUTPUT_SCHEME}:`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export function registerOutputAssetHandler(): void {
  registerOutputAssetProtocolHandler(protocol, 'default session')
  registerOutputAssetProtocolHandler(session.fromPartition(BROWSER_PANE_SESSION_PARTITION).protocol, 'browser-pane session')
}

export function registerOutputAssetProtocolHandler(targetProtocol: Pick<typeof protocol, 'handle'> | Pick<Session['protocol'], 'handle'>, label: string): void {
  targetProtocol.handle(RUNNER_OUTPUT_SCHEME, async (request) => {
    try {
      const parsed = parseRunnerOutputAssetUrl(request.url)
      if (!parsed) return new Response(null, { status: 400 })

      const workspace = getWorkspaceByNameOrId(parsed.workspaceId)
      if (!workspace || workspace.remoteServer) return new Response(null, { status: 404 })

      const safePath = assertOutputAssetPath(workspace.rootPath, parsed.outputId, parsed.assetPath)
      const fileStat = await stat(safePath)
      if (!fileStat.isFile()) return new Response(null, { status: 404 })

      const body = await readFile(safePath)
      return new Response(new Uint8Array(body), {
        headers: {
          'Content-Type': mimeTypeForPath(safePath),
          'Cache-Control': 'no-store',
          'Content-Security-Policy': HTML_PREVIEW_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      mainLog.warn('Output asset protocol request failed:', error)
      return new Response(null, { status: 404 })
    }
  })

  mainLog.info(`Registered ${RUNNER_OUTPUT_SCHEME}:// protocol handler (${label})`)
}

function mimeTypeForPath(path: string): string {
  if (/\.workflow-run\.json$/i.test(path)) return 'application/vnd.runneros.workflow-run+json'
  if (/\.workflow\.json$/i.test(path)) return 'application/vnd.runneros.workflow+json'
  if (/\.(chart|vega|vegalite)\.json$/i.test(path)) return 'application/vnd.runneros.chart+json'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mimeMap: Record<string, string> = {
    css: 'text/css',
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    excalidraw: 'application/vnd.excalidraw+json',
    mp4: 'video/mp4',
    webm: 'video/webm',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json',
    mp3: 'audio/mpeg',
    pdf: 'application/pdf',
    wav: 'audio/wav',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  }
  return mimeMap[ext] ?? 'application/octet-stream'
}
