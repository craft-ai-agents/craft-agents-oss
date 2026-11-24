import { app, type WebContents } from 'electron'
import { appendFile, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { getLogFilePath, mainLog } from '../logger'

/**
 * The spike's measurements: one JSON line per show, capture, insert and resource sample, in
 * `crafty-spike.jsonl` next to `main.log`. The spike report is built from this file.
 * Selected text is never written here, only its length.
 */
export class CraftyMetrics {
  readonly path: string
  private sampler: NodeJS.Timeout | null = null
  private samplerStopAt = 0

  constructor() {
    const logDir = dirname(getLogFilePath() ?? join(app.getPath('logs'), 'main.log'))
    mkdirSync(logDir, { recursive: true })
    this.path = join(logDir, 'crafty-spike.jsonl')
  }

  record(kind: string, data: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), kind, ...data }) + '\n'
    appendFile(this.path, line, (error) => {
      if (error) mainLog.warn('[crafty] metrics write failed', error.message)
    })
  }

  /**
   * Sample CPU and memory every second while the window is visible, then for 5 s after it hides,
   * which shows what the hidden window costs. `webContents` identifies the Crafty renderer.
   */
  startSampling(webContents: WebContents, label: () => string): void {
    this.samplerStopAt = 0
    if (this.sampler) return
    this.sampler = setInterval(() => {
      if (this.samplerStopAt && Date.now() >= this.samplerStopAt) {
        this.stopSamplingNow()
        return
      }
      if (webContents.isDestroyed()) return
      const rendererPid = webContents.getOSProcessId()
      const metrics = app.getAppMetrics()
      const pick = (predicate: (m: Electron.ProcessMetric) => boolean) => {
        const m = metrics.find(predicate)
        return m ? { cpu: round(m.cpu.percentCPUUsage), memMB: round(m.memory.workingSetSize / 1024) } : null
      }
      this.record('resources', {
        state: label(),
        crafty: pick(m => m.pid === rendererPid),
        main: pick(m => m.type === 'Browser'),
        gpu: pick(m => m.type === 'GPU'),
        native: pick(m => m.type === 'Utility' && m.serviceName === 'Crafty native host'),
      })
    }, 1000)
  }

  /** Keep sampling for another 5 s, then stop. */
  stopSampling(): void {
    if (this.sampler && !this.samplerStopAt) this.samplerStopAt = Date.now() + 5000
  }

  private stopSamplingNow(): void {
    if (this.sampler) clearInterval(this.sampler)
    this.sampler = null
    this.samplerStopAt = 0
  }

  dispose(): void {
    this.stopSamplingNow()
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
