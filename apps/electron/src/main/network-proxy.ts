/**
 * Network proxy manager — configures both Node.js (undici) and Electron session proxies.
 *
 * - Node side: replaces the global undici dispatcher with a ProtocolProxyDispatcher
 *   that routes HTTP/HTTPS through different ProxyAgent instances and respects NO_PROXY.
 * - Electron side: calls session.setProxy() on default + browser-pane sessions.
 */

import { execFileSync } from 'node:child_process';
import { app, session } from 'electron';
import { Agent, Dispatcher, ProxyAgent, setGlobalDispatcher } from 'undici';
import {
  normalizeProxyUrl,
  parseNoProxyRules,
  parseWindowsInternetSettings,
  shouldBypassProxy,
  splitCommaSeparated,
  type NoProxyRule,
} from './network-proxy-utils';
import { getNetworkProxySettings, setNetworkProxySettings } from '@craft-agent/shared/config/storage';
import type { NetworkProxySettings } from '@craft-agent/shared/config/types';
import { BROWSER_PANE_SESSION_PARTITION } from './browser-pane-manager';
import log from './logger';

// Track the current dispatcher so we can close it when reconfiguring
let currentProxyDispatcher: Dispatcher | null = null;
const syncedProcessProxyEnv = new Map<string, { applied: string; previous: string | undefined }>();

const WINDOWS_INTERNET_SETTINGS_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/**
 * Custom undici Dispatcher that routes requests through proxy agents based on protocol,
 * bypasses proxied destinations listed in NO_PROXY rules, and falls back to a direct Agent.
 */
class ProtocolProxyDispatcher extends Dispatcher {
  private httpProxy: ProxyAgent | null;
  private httpsProxy: ProxyAgent | null;
  private direct: Agent;
  private rules: NoProxyRule[];

  constructor(opts: {
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string;
  }) {
    super();
    this.httpProxy = opts.httpProxy ? new ProxyAgent(opts.httpProxy) : null;
    this.httpsProxy = opts.httpsProxy ? new ProxyAgent(opts.httpsProxy) : null;
    this.direct = new Agent();
    this.rules = parseNoProxyRules(opts.noProxy);
  }

  dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const url = typeof opts.origin === 'string' ? opts.origin : opts.origin?.toString();

    // If URL matches bypass rules, go direct
    if (url && shouldBypassProxy(url, this.rules)) {
      return this.direct.dispatch(opts, handler);
    }

    // Route based on protocol
    const isHttps = url?.startsWith('https:');
    const proxy = isHttps ? (this.httpsProxy ?? this.httpProxy) : this.httpProxy;

    if (proxy) {
      return proxy.dispatch(opts, handler);
    }

    return this.direct.dispatch(opts, handler);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.httpProxy?.close(),
      this.httpsProxy?.close(),
      this.direct.close(),
    ]);
  }

  async destroy(): Promise<void> {
    await Promise.all([
      this.httpProxy?.destroy(),
      this.httpsProxy?.destroy(),
      this.direct.destroy(),
    ]);
  }
}

function readWindowsSystemProxySettings(): NetworkProxySettings | undefined {
  if (process.platform !== 'win32') return undefined;

  try {
    const output = execFileSync('reg', ['query', WINDOWS_INTERNET_SETTINGS_KEY], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return parseWindowsInternetSettings(output);
  } catch (error) {
    log.warn('[proxy] Failed to read Windows system proxy settings:', error);
    return undefined;
  }
}

function resolveEffectiveProxySettings(
  settings: NetworkProxySettings | undefined,
): NetworkProxySettings | undefined {
  if (settings?.enabled && (settings.httpProxy || settings.httpsProxy)) {
    return {
      ...settings,
      httpProxy: normalizeProxyUrl(settings.httpProxy),
      httpsProxy: normalizeProxyUrl(settings.httpsProxy),
    };
  }
  return readWindowsSystemProxySettings();
}

function syncProcessProxyEnv(settings: NetworkProxySettings | undefined): void {
  for (const [key, { applied, previous }] of syncedProcessProxyEnv) {
    if (process.env[key] !== applied) continue;
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  syncedProcessProxyEnv.clear();

  const httpProxy = settings?.httpProxy;
  const httpsProxy = settings?.httpsProxy ?? httpProxy;

  if (httpProxy) {
    setProcessProxyEnv('HTTP_PROXY', httpProxy);
    setProcessProxyEnv('http_proxy', httpProxy);
  }
  if (httpsProxy) {
    setProcessProxyEnv('HTTPS_PROXY', httpsProxy);
    setProcessProxyEnv('https_proxy', httpsProxy);
  }
  if (settings?.noProxy) {
    setProcessProxyEnv('NO_PROXY', settings.noProxy);
    setProcessProxyEnv('no_proxy', settings.noProxy);
  }
}

function setProcessProxyEnv(key: string, value: string): void {
  const previous = process.env[key];
  process.env[key] = value;
  syncedProcessProxyEnv.set(key, { applied: value, previous });
}

/**
 * Configure the Node.js global undici dispatcher for proxy routing.
 */
function configureNodeProxy(settings: NetworkProxySettings | undefined): void {
  // Close previous dispatcher (proxy or direct — both are tracked)
  if (currentProxyDispatcher) {
    currentProxyDispatcher.close().catch(() => {});
    currentProxyDispatcher = null;
  }

  if (!settings?.enabled || (!settings.httpProxy && !settings.httpsProxy)) {
    // Restore a direct dispatcher and track it so next reconfigure can close it
    const direct = new Agent();
    setGlobalDispatcher(direct);
    currentProxyDispatcher = direct;
    return;
  }

  const dispatcher = new ProtocolProxyDispatcher({
    httpProxy: settings.httpProxy,
    httpsProxy: settings.httpsProxy,
    noProxy: settings.noProxy,
  });

  setGlobalDispatcher(dispatcher);
  currentProxyDispatcher = dispatcher;
}

/**
 * Configure Electron session proxies (default session + browser-pane partition).
 * Requires app to be ready.
 */
async function configureElectronProxy(settings: NetworkProxySettings | undefined): Promise<void> {
  if (!app.isReady()) return;

  const proxyConfig = settings?.enabled
    ? buildElectronProxyConfig(settings)
    : process.platform === 'win32'
      ? { mode: 'system' as const }
      : { mode: 'direct' as const };

  const sessions = [
    session.defaultSession,
    session.fromPartition(BROWSER_PANE_SESSION_PARTITION),
  ];

  await Promise.all(sessions.map(ses => ses.setProxy(proxyConfig)));
}

function buildElectronProxyConfig(settings: NetworkProxySettings): Electron.ProxyConfig {
  const rules: string[] = [];

  if (settings.httpsProxy) {
    rules.push(`https=${settings.httpsProxy}`);
  }
  if (settings.httpProxy) {
    rules.push(`http=${settings.httpProxy}`);
  }

  if (rules.length === 0) {
    return { mode: 'direct' };
  }

  return {
    mode: 'fixed_servers',
    proxyRules: rules.join(';'),
    proxyBypassRules: settings.noProxy
      ? splitCommaSeparated(settings.noProxy).join(',')
      : undefined,
  };
}

/**
 * Read persisted proxy settings and apply to both Node and Electron.
 * Safe to call before app.whenReady() — Electron session setup is skipped until ready.
 */
export async function applyConfiguredProxySettings(): Promise<void> {
  const settings = getNetworkProxySettings();
  const effectiveSettings = resolveEffectiveProxySettings(settings);
  const hasManualProxy = !!settings?.enabled && (!!settings.httpProxy || !!settings.httpsProxy);

  log.info('[proxy] Applying proxy settings:', {
    enabled: effectiveSettings?.enabled ?? false,
    source: hasManualProxy ? 'manual' : effectiveSettings ? 'windows-system' : 'system',
    hasHttpProxy: !!effectiveSettings?.httpProxy,
    hasHttpsProxy: !!effectiveSettings?.httpsProxy,
    hasNoProxy: !!effectiveSettings?.noProxy,
  });

  syncProcessProxyEnv(effectiveSettings);
  configureNodeProxy(effectiveSettings);
  await configureElectronProxy(effectiveSettings);
}

/**
 * Persist new proxy settings and apply immediately.
 */
export async function updateConfiguredProxySettings(settings: NetworkProxySettings): Promise<void> {
  setNetworkProxySettings(settings);
  await applyConfiguredProxySettings();
}
