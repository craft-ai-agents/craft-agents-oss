import { utilityProcess, type UtilityProcess } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { mainLog } from '../logger'
import type { CraftyRect, CraftySelectionResult, CraftyCaptureMethod } from '../../shared/crafty'
import type { FocusedElement, HostMessage, HostMethod, HostSelection, InputEvent, InputStatus, RawSelection } from '../../crafty-native/protocol'

/** selection-hook's `SelectionMethod` ids (index.d.ts). */
const METHOD_AXAPI = 11
const METHOD_CLIPBOARD = 99
/** selection-hook's `PositionLevel`: from SEL_FULL on, the selection's own rectangles are known. */
const POS_LEVEL_SEL_FULL = 3

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

const REQUEST_TIMEOUT_MS = 3000
/** After a crash with the input tap on, the host restarts this many times a minute at most. */
const INPUT_RESTARTS_PER_MINUTE = 3
const INPUT_RESTART_DELAY_MS = 1000

/**
 * The `utilityProcess` that hosts selection-hook and Crafty's input addon (`dist/crafty-native.cjs`).
 * Started lazily, restarted on the next request after a crash (and at once while the input tap is
 * wanted), killed when Crafty stops.
 */
export class CraftyNativeHost {
  private child: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private inputListeners = new Set<(event: InputEvent) => void>()
  /** Set between startInput and stopInput, so a crashed host gets its tap back. */
  private inputWanted = false
  private inputRestarts: number[] = []
  private inputRestartTimer: NodeJS.Timeout | null = null

  private start(): Promise<void> {
    if (this.ready) return this.ready
    const entry = join(__dirname, 'crafty-native.cjs')
    if (!existsSync(entry)) {
      return Promise.reject(new Error(`Crafty native host not built: ${entry}`))
    }
    const child = utilityProcess.fork(entry, [], { serviceName: 'Crafty native host', stdio: 'pipe' })
    this.child = child
    child.stdout?.on('data', (chunk: Buffer) => mainLog.info('[crafty-native]', chunk.toString().trim()))
    child.stderr?.on('data', (chunk: Buffer) => mainLog.warn('[crafty-native]', chunk.toString().trim()))
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Crafty native host did not start'))
        // Else every later request would wait on this failed start
        if (this.child === child) this.detach('Crafty native host did not start')
        child.kill()
      }, 10_000)
      child.on('message', (message: HostMessage) => {
        if ('ready' in message) {
          clearTimeout(timer)
          mainLog.info('[crafty] native host ready', { pid: message.pid })
          resolve()
          return
        }
        if ('input' in message) {
          for (const listener of this.inputListeners) listener(message.input)
          return
        }
        if (typeof message.id !== 'number') return
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(message.result)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`Crafty native host exited (${code})`))
        // Killed on purpose (restart, stop): its requests already failed, and its successor may be running
        if (this.child !== child) return
        mainLog.warn('[crafty] native host exited', { code })
        this.detach(`Crafty native host exited (${code})`)
        if (this.inputWanted) this.scheduleInputRestart()
      })
    })
    return this.ready
  }

  /** Let go of the process: its requests fail now, and the next request starts a new one. */
  private detach(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pending.clear()
    this.child = null
    this.ready = null
  }

  /**
   * Replace the process with a new one, which asks macOS for Accessibility afresh: a running one
   * keeps the "no" it got before a grant. Requests in flight fail; the input tap needs `startInput`.
   */
  async restart(): Promise<void> {
    const child = this.child
    if (child) {
      this.detach('Crafty native host restarted')
      child.kill()
    }
    await this.start()
  }

  private async request<T>(method: HostMethod, params?: Record<string, unknown>): Promise<T> {
    await this.start()
    const child = this.child
    if (!child) throw new Error('Crafty native host is not running')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Crafty native host timed out on ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      child.postMessage({ id, method, params })
    })
  }

  /** Warm the process up so the first shortcut doesn't pay for the fork. */
  warmUp(): void {
    this.start().catch(error => mainLog.warn('[crafty] native host warm-up failed', error))
  }

  /**
   * Read the current selection. `origin` is the overlay window's top-left in screen coordinates,
   * so the returned bounds are in window coordinates.
   */
  async getSelection(origin: { x: number; y: number }): Promise<CraftySelectionResult> {
    try {
      const raw = await this.request<HostSelection>('getSelection')
      if (!raw.selection) return { selection: null, latencyMs: raw.latencyMs, copy: raw.copy }
      const s = raw.selection
      return {
        latencyMs: raw.latencyMs,
        copy: raw.copy,
        selection: {
          text: s.text,
          method: toMethod(s.method),
          rawMethod: s.method,
          posLevel: s.posLevel,
          bounds: s.posLevel >= POS_LEVEL_SEL_FULL ? toBounds(s, origin) : null,
          programName: s.programName,
          isFullscreen: s.isFullscreen,
        },
      }
    } catch (error) {
      return { selection: null, latencyMs: 0, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---- The input addon (double-tap trigger, pointer warp, editable check) ----

  /** Modifier changes from the tap, while it runs. */
  onInput(listener: (event: InputEvent) => void): () => void {
    this.inputListeners.add(listener)
    return () => { this.inputListeners.delete(listener) }
  }

  inputStatus(): Promise<InputStatus> {
    return this.request<InputStatus>('inputStatus')
  }

  /** Start the tap. False when Accessibility is off (the addon never creates an untrusted tap). */
  async startInput(): Promise<boolean> {
    this.inputWanted = true
    return this.request<boolean>('startInput')
  }

  async stopInput(): Promise<void> {
    this.inputWanted = false
    this.clearInputRestart()
    if (this.child) await this.request('stopInput')
  }

  /** Move the pointer to a point in screen coordinates (DIP, which are points on macOS). */
  warp(x: number, y: number): Promise<boolean> {
    return this.request<boolean>('warp', { x, y })
  }

  /** Whether the app's focused element takes text (Replace vs Copy). */
  focusedEditable(pid: number): Promise<FocusedElement> {
    return this.request<FocusedElement>('focusedEditable', { pid })
  }

  private scheduleInputRestart(): void {
    const now = Date.now()
    this.inputRestarts = this.inputRestarts.filter(at => now - at < 60_000)
    if (this.inputRestarts.length >= INPUT_RESTARTS_PER_MINUTE) {
      mainLog.warn('[crafty] native host keeps exiting; the input tap stays off until Crafty restarts')
      this.inputWanted = false
      return
    }
    this.inputRestarts.push(now)
    this.clearInputRestart()
    this.inputRestartTimer = setTimeout(() => {
      this.inputRestartTimer = null
      if (!this.inputWanted) return
      this.request<boolean>('startInput')
        .then(started => mainLog.info('[crafty] input tap restarted after a host exit', { started }))
        .catch(error => mainLog.warn('[crafty] input tap restart failed', error))
    }, INPUT_RESTART_DELAY_MS)
  }

  private clearInputRestart(): void {
    if (this.inputRestartTimer) clearTimeout(this.inputRestartTimer)
    this.inputRestartTimer = null
  }

  /**
   * Kill the process, and the input tap with it. The host stays usable: the next request starts a
   * new process, and input listeners stay registered (the controller adds its listener once, and
   * Crafty can be switched off and on again).
   */
  stop(): void {
    this.inputWanted = false
    this.clearInputRestart()
    const child = this.child
    this.detach('Crafty native host stopped')
    child?.kill()
  }
}

function toMethod(method: number): CraftyCaptureMethod {
  if (method === METHOD_AXAPI) return 'accessibility'
  if (method === METHOD_CLIPBOARD) return 'clipboard'
  return method === 0 ? 'none' : 'other'
}

function toBounds(s: RawSelection, origin: { x: number; y: number }): CraftyRect | null {
  const xs = [s.startTop.x, s.startBottom.x, s.endTop.x, s.endBottom.x]
  const ys = [s.startTop.y, s.startBottom.y, s.endTop.y, s.endBottom.y]
  // selection-hook marks unknown coordinates with -99999
  if ([...xs, ...ys].some(v => !Number.isFinite(v) || v <= -99999)) return null
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  return { x: left - origin.x, y: top - origin.y, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}
