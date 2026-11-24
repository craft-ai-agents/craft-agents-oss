/**
 * Crafty native host (spike). Runs in an Electron `utilityProcess`, built to `dist/crafty-native.cjs`.
 *
 * `selection-hook` reads the selection synchronously on the calling thread, through
 * Accessibility; for apps it can't read, the input addon's ⌘C fallback polls the clipboard for up
 * to ~100 ms (read-selection.ts). Running both here keeps that off the main process. selection-hook's
 * own ⌘C fallback is off: without its input hooks it returns stale clipboard text.
 *
 * It uses the native binding directly, not selection-hook's JS wrapper: the wrapper's
 * `getCurrentSelection()` returns null until `start()`, and `start()` installs global mouse and
 * keyboard event taps (every keystroke, plus an Input Monitoring grant). The native call doesn't
 * need them: "It works before start() as long as accessibility permission is granted"
 * (src/mac/selection_hook.mm). So selection-hook never listens to input, it only reads on a trigger.
 *
 * It also loads Crafty's own input addon (`crafty-input.c`, built to `dist/native/`): the
 * double-tap trigger's event tap, which sees modifier changes only, plus the pointer warp, the
 * editable check and the ⌘C fallback. Optional: without it, only the shortcut opens Crafty, and
 * only selections Accessibility can read reach it.
 *
 * Protocol: `protocol.ts`.
 */

import { dirname, join } from 'path'
import type { ClipboardCopy, FocusedElement, HostRequest, HostSelection, InputEvent, InputStatus, RawSelection } from './protocol'
import { readSelection } from './read-selection'

interface ParentPort {
  on(event: 'message', listener: (event: { data: HostRequest }) => void): void
  postMessage(message: unknown): void
}

/** What the native `getCurrentSelection()` returns (selection-hook 2.x, before its wrapper formats it). */
interface NativeSelection {
  text: string
  programName: string
  startTopX: number
  startTopY: number
  startBottomX: number
  startBottomY: number
  endTopX: number
  endTopY: number
  endBottomX: number
  endBottomY: number
  mouseStartX: number
  mouseStartY: number
  mouseEndX: number
  mouseEndY: number
  method?: number
  posLevel?: number
  isFullscreen?: boolean
}

interface NativeSelectionHook {
  getCurrentSelection(): NativeSelection | null
  disableClipboard(): void
  macIsProcessTrusted(): boolean
  macRequestProcessTrust(): boolean
}

/** `crafty-input.c`'s exports. */
interface InputAddon {
  start(onEvent: (event: InputEvent) => void): boolean
  stop(): void
  running(): boolean
  isTrusted(): boolean
  warp(x: number, y: number): boolean
  focusedEditable(pid: number): FocusedElement
  copySelection(timeoutMs: number): ClipboardCopy
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
if (!parentPort) {
  throw new Error('crafty-native must run in an Electron utilityProcess')
}
const port: ParentPort = parentPort

// node-gyp-build finds the prebuilt binary in selection-hook's folder, as selection-hook's own
// index.js does. Both packages are runtime dependencies (extraResources in the packaged app).
const gypBuild = require('node-gyp-build') as (dir: string) => { TextSelectionHook: new () => NativeSelectionHook }
const hook = new (gypBuild(dirname(require.resolve('selection-hook'))).TextSelectionHook)()
// Accessibility only: the ⌘C fallback is the input addon's (read-selection.ts says why)
hook.disableClipboard()
/** The input addon's ⌘C fallback (`setClipboardFallback`; probes turn it off). */
let clipboardFallback = true

let input: InputAddon | null = null
let inputError: string | null = null
try {
  // A computed path, so esbuild leaves it to Node's require
  const addonPath = join(__dirname, 'native', 'crafty-input.node')
  input = require(addonPath) as InputAddon
} catch (error) {
  inputError = error instanceof Error ? error.message : String(error)
}

function requireInput(): InputAddon {
  if (!input) throw new Error(`Crafty's input addon isn't available: ${inputError ?? 'not loaded'}`)
  return input
}

function numberParam(request: HostRequest, key: string): number {
  const value = request.params?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${request.method}: ${key} must be a number`)
  return value
}

function point(x: number, y: number) {
  return { x, y }
}

/** selection-hook's Accessibility read, in the shape its wrapper produces (its #formatSelectionData). */
function accessibilitySelection(): RawSelection | null {
  const selection = hook.getCurrentSelection()
  if (!selection) return null
  return {
    text: selection.text,
    programName: selection.programName,
    method: selection.method || 0,
    posLevel: selection.posLevel || 0,
    startTop: point(selection.startTopX, selection.startTopY),
    startBottom: point(selection.startBottomX, selection.startBottomY),
    endTop: point(selection.endTopX, selection.endTopY),
    endBottom: point(selection.endBottomX, selection.endBottomY),
    mousePosStart: point(selection.mouseStartX, selection.mouseStartY),
    mousePosEnd: point(selection.mouseEndX, selection.mouseEndY),
    isFullscreen: selection.isFullscreen,
  }
}

function getSelection(): HostSelection {
  const addon = input
  return readSelection(
    {
      accessibility: accessibilitySelection,
      copy: addon ? timeoutMs => addon.copySelection(timeoutMs) : null,
      now: () => performance.now(),
    },
    { clipboardFallback },
  )
}

function handle(request: HostRequest): unknown {
  switch (request.method) {
    case 'getSelection':
      return getSelection()
    case 'isTrusted':
      return hook.macIsProcessTrusted()
    case 'requestTrust':
      return hook.macRequestProcessTrust()
    case 'setClipboardFallback':
      clipboardFallback = request.params?.enabled !== false
      return true
    case 'inputStatus': {
      const status: InputStatus = {
        available: !!input,
        error: inputError,
        trusted: input ? input.isTrusted() : hook.macIsProcessTrusted(),
        running: input?.running() ?? false,
      }
      return status
    }
    case 'startInput':
      // False when Accessibility is off: the addon never creates an untrusted tap (no prompt)
      return requireInput().start(event => port.postMessage({ input: event }))
    case 'stopInput':
      input?.stop()
      return true
    case 'warp':
      return requireInput().warp(numberParam(request, 'x'), numberParam(request, 'y'))
    case 'focusedEditable':
      return requireInput().focusedEditable(numberParam(request, 'pid'))
  }
}

port.on('message', ({ data }) => {
  try {
    port.postMessage({ id: data.id, result: handle(data) })
  } catch (error) {
    port.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})

port.postMessage({ ready: true, pid: process.pid })
