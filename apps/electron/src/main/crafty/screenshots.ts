import { app, nativeImage } from 'electron'
import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { readFile, readdir, stat } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { extname, join } from 'path'
import type { CraftyRecentScreenshot, CraftyScreenshot } from '../../shared/crafty'

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/** How recent a screenshot must be for the panel to offer it. */
export const RECENT_SCREENSHOT_MAX_AGE_S = 60

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => {
      // error.code is the exit status, or a string such as ETIMEDOUT when the process never exited
      const code = !error ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ code, stdout: String(stdout ?? '') })
    })
  })
}

let folderCache: { path: string; at: number } | null = null

/** macOS's screenshots folder (`com.apple.screencapture location`, else the Desktop). */
async function screenshotsFolder(): Promise<string> {
  if (folderCache && Date.now() - folderCache.at < 60_000) return folderCache.path
  const { code, stdout } = await run('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], 2000)
  const configured = code === 0 ? stdout.trim().replace(/^~(?=$|\/)/, homedir()) : ''
  const path = configured && existsSync(configured) ? configured : app.getPath('desktop')
  folderCache = { path, at: Date.now() }
  return path
}

/**
 * The newest image in the screenshots folder from the last minute. macOS writes the file once its
 * floating thumbnail goes away (about 5 s), so a fresh screenshot shows up with that delay.
 * HEIC is skipped: Electron can't decode it for the chip, and the spike doesn't transcode.
 */
export async function findRecentScreenshot(): Promise<CraftyRecentScreenshot | null> {
  try {
    const folder = await screenshotsFolder()
    const now = Date.now()
    let best: CraftyRecentScreenshot | null = null
    let bestTime = 0
    for (const name of await readdir(folder)) {
      if (name.startsWith('.') || !IMAGE_MIME[extname(name).toLowerCase()]) continue
      const path = join(folder, name)
      const info = await stat(path).catch(() => null)
      if (!info?.isFile()) continue
      const created = info.birthtimeMs || info.mtimeMs
      const ageSeconds = (now - created) / 1000
      if (ageSeconds < 0 || ageSeconds > RECENT_SCREENSHOT_MAX_AGE_S) continue
      if (created > bestTime) {
        bestTime = created
        best = { path, name, ageSeconds: Math.round(ageSeconds) }
      }
    }
    return best
  } catch {
    return null
  }
}

/**
 * Let the user drag out a region with macOS's own picker (`screencapture -i`). Resolves to null
 * when they press Esc. Without the Screen Recording grant macOS captures only the wallpaper.
 */
export async function captureRegion(): Promise<string | null> {
  const path = join(tmpdir(), `crafty-region-${Date.now()}.png`)
  await run('/usr/sbin/screencapture', ['-i', '-x', '-t', 'png', path], 120_000)
  return existsSync(path) ? path : null
}

/** Read an image into the attachment shape `sendMessage` expects, plus a small chip thumbnail. */
export async function toScreenshot(path: string, name: string): Promise<CraftyScreenshot> {
  const data = await readFile(path)
  const mimeType = IMAGE_MIME[extname(path).toLowerCase()] ?? 'image/png'
  const image = nativeImage.createFromBuffer(data)
  const thumbnail = image.isEmpty() ? '' : image.resize({ width: 160, quality: 'good' }).toDataURL()
  return {
    path,
    name,
    thumbnailDataUrl: thumbnail,
    attachment: {
      type: 'image',
      path,
      name,
      mimeType,
      base64: data.toString('base64'),
      size: data.length,
    },
  }
}
