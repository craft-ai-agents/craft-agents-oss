import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, isAbsolute, join } from 'node:path'
import type { PluginDetails } from '@craft-agent/shared/plugins'

export interface ExternalPluginPackage {
  manifest: PluginDetails
  pluginRoot: string
}

interface PluginBridgeRuntimeOptions {
  helperRuntimePath?: string
  activationTimeoutMs?: number
}

export class PluginBridgeRuntime {
  private readonly helperRuntimePath?: string
  private readonly activationTimeoutMs: number

  constructor(options: PluginBridgeRuntimeOptions = {}) {
    this.helperRuntimePath = options.helperRuntimePath
    this.activationTimeoutMs = options.activationTimeoutMs ?? 5_000
  }

  resolveHelperPath(plugin: ExternalPluginPackage): string | undefined {
    const entrypoint = plugin.manifest.entrypoints?.main || plugin.manifest.entrypoints?.helper
    if (!entrypoint) return undefined
    return isAbsolute(entrypoint) ? entrypoint : join(plugin.pluginRoot, entrypoint)
  }

  async activate(plugin: ExternalPluginPackage): Promise<{ helperPath?: string }> {
    const helperPath = this.resolveHelperPath(plugin)
    if (!helperPath) {
      return {}
    }

    const runtimePath = this.helperRuntimePath || process.execPath

    await new Promise<void>((resolve, reject) => {
      const spawnHelper = () => (
        runtimePath && existsSync(runtimePath) && basename(runtimePath) !== 'node'
          ? spawn(runtimePath, [helperPath], {
            cwd: plugin.pluginRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: process.env,
          })
          : spawn('node', [helperPath], {
            cwd: plugin.pluginRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: process.env,
          })
      )

      const child = spawnHelper()

      let settled = false
      let stderr = ''
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error(`Plugin helper activation timed out for ${plugin.manifest.id}`))
      }, this.activationTimeoutMs)

      const finalize = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          child.kill()
        } catch {
          // Ignore best-effort cleanup failures.
        }
        fn()
      }

      const readline = createInterface({
        input: child.stdout!,
        crlfDelay: Infinity,
      })

      readline.on('line', (line) => {
        if (!line.trim() || settled) return
        try {
          const message = JSON.parse(line) as { type?: string; message?: string }
          if (message.type === 'ready') {
            finalize(resolve)
            return
          }
          if (message.type === 'error') {
            finalize(() => reject(new Error(message.message || `Plugin helper activation failed for ${plugin.manifest.id}`)))
          }
        } catch {
          // Ignore non-JSON stdout noise during readiness probes.
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => {
        finalize(() => reject(error instanceof Error ? error : new Error(String(error))))
      })

      child.on('exit', (code, signal) => {
        if (settled) return
        const message = stderr.trim()
          || `Plugin helper exited before ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
        finalize(() => reject(new Error(message)))
      })
    })

    return { helperPath }
  }
}
