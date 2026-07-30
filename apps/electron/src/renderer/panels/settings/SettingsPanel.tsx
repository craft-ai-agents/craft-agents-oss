import React, { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
  Brain,
  Coffee,
  Globe,
  Server,
  ShieldAlert,
  Check,
  User,
  Bot,
  Wrench,
  Puzzle,
  Lock,
  SlidersHorizontal,
  Palette,
  Keyboard,
} from 'lucide-react'
import { THINKING_LEVEL_IDS, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import type { NetworkProxySettings } from '@craft-agent/shared/config'
import type { ServerStatus } from '@craft-agent/shared/config/server-config'
import { actionsByCategory, useActionLabel, type ActionId } from '@/actions'
import { isMac } from '@/lib/platform'
import './SettingsPanel.css'

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

type SaveState = 'idle' | 'saving' | 'saved'

function SoonBadge() {
  return <span className="settings-soon">Coming soon</span>
}

export function SettingsPanel() {
  const [thinking, setThinking] = useState<ThinkingLevel | null>(null)
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null)
  const [proxy, setProxy] = useState<NetworkProxySettings | null>(null)
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null)
  const [confirmBeforeExit, setConfirmBeforeExit] = useState<boolean | null>(null)
  const [compactUI, setCompactUI] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem('archstudio:compactUI') === 'true'
      } catch {
        return false
      }
    }
  )
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [saved, setSaved] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Initial load — each setting has its own handler, so failures are isolated.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [level, awake, proxyCfg, status, launchCfg, exitCfg] = await Promise.all([
          window.electronAPI.getDefaultThinkingLevel(),
          window.electronAPI.getKeepAwakeWhileRunning(),
          window.electronAPI.getNetworkProxySettings(),
          window.electronAPI.getServerStatus(),
          window.electronAPI.getLaunchAtLogin(),
          window.electronAPI.getConfirmBeforeExit(),
        ])
        if (cancelled) return
        setThinking(level)
        setKeepAwake(awake)
        setProxy(proxyCfg ?? { enabled: false })
        setServerStatus(status)
        setLaunchAtLogin(launchCfg)
        setConfirmBeforeExit(exitCfg)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const flashSaved = () => {
    setSaved('saved')
    setTimeout(() => setSaved('idle'), 1600)
  }

  const changeThinking = async (level: ThinkingLevel) => {
    const previous = thinking
    setThinking(level)
    setSaved('saving')
    try {
      await window.electronAPI.setDefaultThinkingLevel(level)
      flashSaved()
    } catch (err) {
      setThinking(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeKeepAwake = async (value: boolean) => {
    const previous = keepAwake
    setKeepAwake(value)
    setSaved('saving')
    try {
      await window.electronAPI.setKeepAwakeWhileRunning(value)
      flashSaved()
    } catch (err) {
      setKeepAwake(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const commitProxy = async (next: NetworkProxySettings) => {
    setProxy(next)
    setSaved('saving')
    try {
      await window.electronAPI.setNetworkProxySettings(next)
      flashSaved()
    } catch (err) {
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeLaunchAtLogin = async (value: boolean) => {
    const previous = launchAtLogin
    setLaunchAtLogin(value)
    setSaved('saving')
    try {
      await window.electronAPI.setLaunchAtLogin(value)
      flashSaved()
    } catch (err) {
      setLaunchAtLogin(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeConfirmBeforeExit = async (value: boolean) => {
    const previous = confirmBeforeExit
    setConfirmBeforeExit(value)
    setSaved('saving')
    try {
      await window.electronAPI.setConfirmBeforeExit(value)
      flashSaved()
    } catch (err) {
      setConfirmBeforeExit(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleExportSettings = async () => {
    setExportMsg(null)
    try {
      const result = await window.electronAPI.exportSettings()
      if (result.success) {
        setExportMsg(`Exported to ${result.path}`)
        setTimeout(() => setExportMsg(null), 3000)
      } else if (!result.canceled) {
        setExportMsg(`Export failed: ${result.error}`)
        setTimeout(() => setExportMsg(null), 5000)
      }
    } catch (err) {
      setExportMsg(`Export error: ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setExportMsg(null), 5000)
    }
  }

  const handleImportSettings = async () => {
    setImportMsg(null)
    try {
      const result = await window.electronAPI.importSettings()
      if (result.success) {
        setImportMsg('Settings imported successfully!')
        setTimeout(() => setImportMsg(null), 3000)
      } else if (!result.canceled) {
        setImportMsg(`Import failed: ${result.error}`)
        setTimeout(() => setImportMsg(null), 5000)
      }
    } catch (err) {
      setImportMsg(`Import error: ${err instanceof Error ? err.message : String(err)}`)
      setTimeout(() => setImportMsg(null), 5000)
    }
  }

  const changeCompactUI = (value: boolean) => {
    setCompactUI(value)
    try {
      if (value) {
        localStorage.setItem('archstudio:compactUI', 'true')
        document.documentElement.classList.add('compact-ui')
      } else {
        localStorage.removeItem('archstudio:compactUI')
        document.documentElement.classList.remove('compact-ui')
      }
    } catch {
      // localStorage write failure — silently degrade
    }
  }

  // Apply compact UI class on mount from persisted localStorage
  useEffect(() => {
    if (compactUI) {
      document.documentElement.classList.add('compact-ui')
    } else {
      document.documentElement.classList.remove('compact-ui')
    }
  }, []) // only on mount — the change handler keeps it in sync

  return (
    <div className="settings-panel">
      <div className="settings-panel__header">
        <div className="settings-panel__title">
          <SettingsIcon size={20} />
          <h2>Settings</h2>
        </div>
        {saved !== 'idle' && (
          <span className={`settings-panel__saved${saved === 'saved' ? ' is-done' : ''}`}>
            {saved === 'saving' ? 'Saving…' : (
              <>
                <Check size={13} /> Saved
              </>
            )}
          </span>
        )}
      </div>

      <div className="settings-panel__body">
        {error && <div className="settings-error">{error}</div>}

        <section className="settings-section">
          <div className="settings-section__head">
            <Brain size={16} />
            <h3>Reasoning</h3>
          </div>
          <p className="settings-section__lead">
            Default thinking level for new sessions. Higher levels reason longer and cost more tokens.
          </p>
          <div className="settings-levels">
            {THINKING_LEVEL_IDS.map((level) => (
              <button
                key={level}
                type="button"
                className={`settings-level${thinking === level ? ' is-active' : ''}`}
                disabled={thinking === null}
                onClick={() => void changeThinking(level)}
              >
                {THINKING_LABELS[level]}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Coffee size={16} />
            <h3>Power</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Keep awake while running</span>
              <span className="settings-row__hint">
                Prevents sleep while an agent session is active.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={keepAwake ?? false}
              disabled={keepAwake === null}
              onChange={(e) => void changeKeepAwake(e.target.checked)}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Globe size={16} />
            <h3>Network proxy</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Route traffic through a proxy</span>
              <span className="settings-row__hint">Applies to model and integration requests.</span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={proxy?.enabled ?? false}
              disabled={proxy === null}
              onChange={(e) => void commitProxy({ ...(proxy ?? {}), enabled: e.target.checked })}
            />
          </label>

          {proxy?.enabled && (
            <div className="settings-fields">
              <label className="settings-field">
                <span>HTTP proxy</span>
                <input
                  type="text"
                  placeholder="http://proxy.local:8080"
                  value={proxy.httpProxy ?? ''}
                  onChange={(e) => setProxy({ ...proxy, httpProxy: e.target.value })}
                  onBlur={() => void commitProxy(proxy)}
                />
              </label>
              <label className="settings-field">
                <span>HTTPS proxy</span>
                <input
                  type="text"
                  placeholder="http://proxy.local:8080"
                  value={proxy.httpsProxy ?? ''}
                  onChange={(e) => setProxy({ ...proxy, httpsProxy: e.target.value })}
                  onBlur={() => void commitProxy(proxy)}
                />
              </label>
              <label className="settings-field">
                <span>No proxy for</span>
                <input
                  type="text"
                  placeholder="localhost, 127.0.0.1, .internal"
                  value={proxy.noProxy ?? ''}
                  onChange={(e) => setProxy({ ...proxy, noProxy: e.target.value })}
                  onBlur={() => void commitProxy(proxy)}
                />
              </label>
            </div>
          )}
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Server size={16} />
            <h3>Remote server</h3>
          </div>
          {serverStatus === null ? (
            <p className="settings-section__lead">Loading server status…</p>
          ) : (
            <>
              <div className="settings-status">
                <span className={`settings-dot${serverStatus.running ? ' is-on' : ''}`} />
                <span>{serverStatus.running ? 'Running' : 'Stopped'}</span>
                {serverStatus.running && <code>{serverStatus.url}</code>}
                {serverStatus.tls && <span className="settings-tag">TLS</span>}
              </div>
              {serverStatus.insecureWarning && (
                <div className="settings-warn">
                  <ShieldAlert size={14} />
                  Bound to a network address without TLS — traffic is unencrypted.
                </div>
              )}
              {serverStatus.needsRestart && (
                <div className="settings-warn">
                  <ShieldAlert size={14} />
                  Saved config differs from the running server. Restart to apply.
                </div>
              )}
            </>
          )}
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <User size={16} />
            <h3>General</h3>
          </div>
          <p className="settings-section__lead">Application-wide defaults and behaviours.</p>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Launch at login</span>
              <span className="settings-row__hint">Start ARCHstudio automatically when you sign in.</span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={launchAtLogin ?? false}
              disabled={launchAtLogin === null}
              onChange={(e) => void changeLaunchAtLogin(e.target.checked)}
            />
          </label>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Confirm before exit</span>
              <span className="settings-row__hint">Show a confirmation dialog when closing the app.</span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={confirmBeforeExit ?? false}
              disabled={confirmBeforeExit === null}
              onChange={(e) => void changeConfirmBeforeExit(e.target.checked)}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Palette size={16} />
            <h3>Appearance</h3>
          </div>
          <p className="settings-section__lead">Theme, accent colour, and interface density.</p>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Compact UI</span>
              <span className="settings-row__hint">Reduce padding and font size throughout the app.</span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={compactUI}
              onChange={(e) => void changeCompactUI(e.target.checked)}
            />
          </label>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Brain size={16} />
            <h3>Models</h3>
          </div>
          <p className="settings-section__lead">Default model and provider preferences.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Default model</span>
              <span className="settings-row__hint">Model used for new sessions.</span>
            </div>
            <SoonBadge />
            <select className="settings-select" disabled>
              <option>Auto-select</option>
              <option>GPT-4.1</option>
              <option>Claude 3.7 Sonnet</option>
              <option>Claude 3.5 Haiku</option>
            </select>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Bot size={16} />
            <h3>Agents</h3>
          </div>
          <p className="settings-section__lead">Agent personas, pets, and companion behaviour.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Enable agent pets</span>
              <span className="settings-row__hint">Show a small companion avatar in the session view.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" disabled />
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Pet style</span>
              <span className="settings-row__hint">Choose your companion appearance.</span>
            </div>
            <SoonBadge />
            <select className="settings-select" disabled>
              <option>ARCH Orb</option>
              <option>Classic Dot</option>
              <option>Minimal</option>
            </select>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Wrench size={16} />
            <h3>Tools</h3>
          </div>
          <p className="settings-section__lead">Default tool permissions and timeouts.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Allow code execution</span>
              <span className="settings-row__hint">Agents can run code in sandboxed terminals.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" defaultChecked disabled />
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Puzzle size={16} />
            <h3>Integrations</h3>
          </div>
          <p className="settings-section__lead">Connected providers and third-party services.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">GitHub</span>
              <span className="settings-row__hint">Connect repositories and issue trackers.</span>
            </div>
            <SoonBadge />
            <button type="button" className="settings-button" disabled>Connect</button>
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Figma</span>
              <span className="settings-row__hint">Import designs and comments.</span>
            </div>
            <SoonBadge />
            <button type="button" className="settings-button" disabled>Connect</button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Lock size={16} />
            <h3>Privacy</h3>
          </div>
          <p className="settings-section__lead">Data retention and telemetry controls.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Telemetry</span>
              <span className="settings-row__hint">Share anonymous usage data to improve the product.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" defaultChecked disabled />
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Retain session history</span>
              <span className="settings-row__hint">Keep chat history locally until manually deleted.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" defaultChecked disabled />
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <SlidersHorizontal size={16} />
            <h3>Advanced</h3>
          </div>
          <p className="settings-section__lead">Experimental features and developer options.</p>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Developer mode</span>
              <span className="settings-row__hint">Expose internal debug panels and logging.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" disabled />
          </div>
          <div className="settings-row">
            <div>
              <span className="settings-row__label">Experimental media generation</span>
              <span className="settings-row__hint">Enable early image, video and music creation tools.</span>
            </div>
            <SoonBadge />
            <input type="checkbox" className="settings-switch" disabled />
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <SlidersHorizontal size={16} />
            <h3>Export / Import</h3>
          </div>
          <p className="settings-section__lead">
            Backup your settings or restore from a previous export. This includes
            config, LLM connections, preferences, and custom themes.
          </p>
          <div className="settings-export-row">
            <div className="settings-export-actions">
              <button
                type="button"
                className="settings-button settings-button--primary"
                onClick={() => void handleExportSettings()}
              >
                Export Settings
              </button>
              <button
                type="button"
                className="settings-button"
                onClick={() => void handleImportSettings()}
              >
                Import Settings
              </button>
            </div>
            {exportMsg && <span className="settings-export-msg">{exportMsg}</span>}
            {importMsg && <span className="settings-export-msg settings-export-msg--import">{importMsg}</span>}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section__head">
            <Keyboard size={16} />
            <h3>Keyboard Shortcuts</h3>
          </div>
          <p className="settings-section__lead">Global shortcuts and quick actions available throughout the app.</p>
          <div className="settings-shortcuts">
            {Object.entries(actionsByCategory).map(([category, actions]) => (
              <div key={category} className="settings-shortcuts__group">
                <span className="settings-shortcuts__category">{category}</span>
                {actions.map(action => (
                  <ShortcutRow key={action.id} actionId={action.id as ActionId} />
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function ShortcutRow({ actionId }: { actionId: ActionId }) {
  const { label, description, hotkey } = useActionLabel(actionId)
  if (!hotkey) return null

  const keys = isMac
    ? hotkey.match(/[⌘⇧⌥←→]|Tab|Esc|./g) || []
    : hotkey.split('+')

  return (
    <div className="settings-shortcut-row">
      <div>
        <div className="settings-shortcut-row__label">{label}</div>
        {description && (
          <div className="settings-shortcut-row__desc">{description}</div>
        )}
      </div>
      <div className="settings-shortcut-row__keys">
        {keys.map((key, i) => (
          <kbd key={i} className="settings-shortcut-kbd">{key}</kbd>
        ))}
      </div>
    </div>
  )
}
