import { app, session } from 'electron'
import { Agent, Dispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'
import { getNetworkProxySettings, setNetworkProxySettings, type NetworkProxySettings } from '@craft-agent/shared/config'
import { BROWSER_PANE_SESSION_PARTITION } from './browser-pane-manager'
import { mainLog } from './logger'
import { parseNoProxyRules, shouldBypassProxy, type NoProxyRule } from './network-proxy-utils'

type ElectronProxyConfig =
  | { mode: 'direct' }
  | { mode: 'fixed_servers'; proxyRules: string; proxyBypassRules?: string }

let currentNodeDispatcher: Dispatcher | null = null

class ProtocolProxyDispatcher extends Dispatcher {
  private readonly directAgent = new Agent()
  private readonly httpProxyAgent?: ProxyAgent
  private readonly httpsProxyAgent?: ProxyAgent
  private readonly noProxyRules: NoProxyRule[]

  constructor(settings: NetworkProxySettings) {
    super()
    this.noProxyRules = parseNoProxyRules(settings.noProxy)
    if (settings.httpProxy) {
      this.httpProxyAgent = new ProxyAgent(settings.httpProxy)
    }
    if (settings.httpsProxy) {
      this.httpsProxyAgent = new ProxyAgent(settings.httpsProxy)
    }
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin = typeof options.origin === 'string'
      ? options.origin
      : options.origin?.toString()

    let protocol: string | null = null
    if (origin) {
      try {
        const url = new URL(origin)
        protocol = url.protocol
        if (shouldBypassProxy(url, this.noProxyRules)) {
          return this.directAgent.dispatch(options, handler)
        }
      } catch {
        protocol = null
      }
    }

    const dispatcher = protocol === 'http:'
      ? (this.httpProxyAgent ?? this.directAgent)
      : protocol === 'https:'
        ? (this.httpsProxyAgent ?? this.httpProxyAgent ?? this.directAgent)
        : (this.httpsProxyAgent ?? this.httpProxyAgent ?? this.directAgent)

    return dispatcher.dispatch(options, handler)
  }

  async close(): Promise<void> {
    await Promise.all(this.getUniqueDispatchers().map((dispatcher) => dispatcher.close()))
  }

  destroy(err: Error | null, callback: () => void): void
  destroy(callback: () => void): void
  destroy(err: Error | null): Promise<void>
  destroy(): Promise<void>
  destroy(errOrCallback?: Error | null | (() => void), callback?: () => void): Promise<void> | void {
    const err = typeof errOrCallback === 'function' ? null : (errOrCallback ?? null)
    const done = typeof errOrCallback === 'function' ? errOrCallback : callback

    const promise = Promise.all(
      this.getUniqueDispatchers().map((dispatcher) => dispatcher.destroy(err))
    ).then(() => undefined)

    if (done) {
      void promise.then(() => done())
      return
    }

    return promise
  }

  private getUniqueDispatchers(): Dispatcher[] {
    return [...new Set([
      this.directAgent,
      this.httpProxyAgent,
      this.httpsProxyAgent,
    ].filter((dispatcher): dispatcher is Dispatcher => !!dispatcher))]
  }
}

function replaceGlobalNodeDispatcher(nextDispatcher: Dispatcher): void {
  const previousDispatcher = currentNodeDispatcher
  currentNodeDispatcher = nextDispatcher
  setGlobalDispatcher(nextDispatcher)

  if (previousDispatcher) {
    void previousDispatcher.close().catch((error) => {
      mainLog.warn('[proxy] Failed to close previous Node dispatcher', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

function buildNodeDispatcher(settings: NetworkProxySettings): Dispatcher {
  if (!settings.enabled || (!settings.httpProxy && !settings.httpsProxy)) {
    return new Agent()
  }

  return new ProtocolProxyDispatcher(settings)
}

function configureNodeProxy(settings: NetworkProxySettings): void {
  replaceGlobalNodeDispatcher(buildNodeDispatcher(settings))

  if (settings.enabled && (settings.httpProxy || settings.httpsProxy)) {
    mainLog.info('[proxy] Configured Node fetch proxy from app settings', {
      enabled: true,
      hasHttpProxy: !!settings.httpProxy,
      hasHttpsProxy: !!settings.httpsProxy,
      hasNoProxy: !!settings.noProxy,
    })
    return
  }

  mainLog.info('[proxy] Cleared Node fetch proxy from app settings')
}

function getElectronProxyConfig(settings: NetworkProxySettings): ElectronProxyConfig {
  if (!settings.enabled) {
    return { mode: 'direct' }
  }

  const httpProxy = settings.httpProxy
  const httpsProxy = settings.httpsProxy || httpProxy
  const proxyRules = [
    httpProxy ? `http=${httpProxy}` : null,
    httpsProxy ? `https=${httpsProxy}` : null,
  ].filter((value): value is string => !!value).join(';')

  if (!proxyRules) {
    return { mode: 'direct' }
  }

  return {
    mode: 'fixed_servers',
    proxyRules,
    proxyBypassRules: settings.noProxy || undefined,
  }
}

async function configureElectronProxy(settings: NetworkProxySettings): Promise<void> {
  if (!app.isReady()) return

  const proxyConfig = getElectronProxyConfig(settings)
  await Promise.all([
    session.defaultSession.setProxy(proxyConfig),
    session.fromPartition(BROWSER_PANE_SESSION_PARTITION).setProxy(proxyConfig),
  ])

  mainLog.info('[proxy] Applied Electron proxy from app settings', {
    enabled: settings.enabled,
    hasHttpProxy: !!settings.httpProxy,
    hasHttpsProxy: !!settings.httpsProxy,
    hasNoProxy: !!settings.noProxy,
  })
}

export async function applyConfiguredProxySettings(): Promise<void> {
  const settings = getNetworkProxySettings()
  configureNodeProxy(settings)
  await configureElectronProxy(settings)
}

export async function updateConfiguredProxySettings(settings: NetworkProxySettings): Promise<void> {
  setNetworkProxySettings(settings)
  await applyConfiguredProxySettings()
}
