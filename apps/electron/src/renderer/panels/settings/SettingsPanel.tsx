import React, { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
  Brain,
  Coffee,
  Check,
  SlidersHorizontal,
  Palette,
  Radio,
  BellRing,
  Zap,
  Globe,
  Keyboard,
} from 'lucide-react'
import { THINKING_LEVEL_IDS, type ThinkingLevel } from '@archstudio/shared/agent/thinking-levels'
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

export function SettingsPanel() {
  const [thinking, setThinking] = useState<ThinkingLevel | null>(null)
  const [keepAwake, setKeepAwake] = useState<boolean | null>(null)
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean | null>(null)
  const [browserToolEnabled, setBrowserToolEnabled] = useState<boolean | null>(null)
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter' | null>(null)
  const [spellCheck, setSpellCheck] = useState<boolean | null>(null)
  const [autoCapitalisation, setAutoCapitalisation] = useState<boolean | null>(null)
  const [localMcpEnabled, setLocalMcpEnabled] = useState<boolean | null>(null)
  const [extendedPromptCache, setExtendedPromptCache] = useState<boolean | null>(null)
  const [allowRemoteEvaluate, setAllowRemoteEvaluate] = useState<boolean | null>(null)
  const [richToolDescriptions, setRichToolDescriptions] = useState<boolean | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
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
        const [level, awake, notif, browserTool, sendKey, spell, autoCap, mcp, cache, remote, toolDesc] = await Promise.all([
          window.electronAPI.getDefaultThinkingLevel(),
          window.electronAPI.getKeepAwakeWhileRunning(),
          window.electronAPI.getNotificationsEnabled(),
          window.electronAPI.getBrowserToolEnabled(),
          window.electronAPI.getSendMessageKey(),
          window.electronAPI.getSpellCheck(),
          window.electronAPI.getAutoCapitalisation(),
          window.electronAPI.getLocalMcpEnabled?.(),
          window.electronAPI.getExtendedPromptCache?.(),
          window.electronAPI.getAllowRemoteEvaluate?.(),
          window.electronAPI.getRichToolDescriptions?.(),
        ])
        if (cancelled) return
        setThinking(level)
        setKeepAwake(awake)
        setNotificationsEnabled(notif)
        setBrowserToolEnabled(browserTool)
        setSendMessageKey(sendKey)
        setSpellCheck(spell)
        setAutoCapitalisation(autoCap)
        setLocalMcpEnabled(mcp ?? false)
        setExtendedPromptCache(cache ?? false)
        setAllowRemoteEvaluate(remote ?? true)
        setRichToolDescriptions(toolDesc ?? true)

        // Try to get git user name from global config for personalizing settings header
        try {
          const gitName = await window.electronAPI.getGitUserName?.()
          if (!cancelled && gitName) {
            setUserName(gitName)
          }
        } catch {
          // Silently fail if git user name unavailable
          if (!cancelled) setUserName(null)
        }
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

  const changeNotifications = async (value: boolean) => {
    const previous = notificationsEnabled
    setNotificationsEnabled(value)
    setSaved('saving')
    try {
      await window.electronAPI.setNotificationsEnabled(value)
      flashSaved()
    } catch (err) {
      setNotificationsEnabled(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeBrowserTool = async (value: boolean) => {
    const previous = browserToolEnabled
    setBrowserToolEnabled(value)
    setSaved('saving')
    try {
      await window.electronAPI.setBrowserToolEnabled(value)
      flashSaved()
    } catch (err) {
      setBrowserToolEnabled(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeSendMessageKey = async (value: string) => {
    const key = value as 'enter' | 'cmd-enter'
    const previous = sendMessageKey
    setSendMessageKey(key)
    setSaved('saving')
    try {
      await window.electronAPI.setSendMessageKey(key)
      flashSaved()
    } catch (err) {
      setSendMessageKey(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeSpellCheck = async (value: boolean) => {
    const previous = spellCheck
    setSpellCheck(value)
    setSaved('saving')
    try {
      await window.electronAPI.setSpellCheck(value)
      flashSaved()
    } catch (err) {
      setSpellCheck(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeAutoCapitalisation = async (value: boolean) => {
    const previous = autoCapitalisation
    setAutoCapitalisation(value)
    setSaved('saving')
    try {
      await window.electronAPI.setAutoCapitalisation(value)
      flashSaved()
    } catch (err) {
      setAutoCapitalisation(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeLocalMcp = async (value: boolean) => {
    const previous = localMcpEnabled
    setLocalMcpEnabled(value)
    setSaved('saving')
    try {
      await window.electronAPI.setLocalMcpEnabled?.(value)
      flashSaved()
    } catch (err) {
      setLocalMcpEnabled(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeExtendedCache = async (value: boolean) => {
    const previous = extendedPromptCache
    setExtendedPromptCache(value)
    setSaved('saving')
    try {
      await window.electronAPI.setExtendedPromptCache?.(value)
      flashSaved()
    } catch (err) {
      setExtendedPromptCache(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeAllowRemoteEval = async (value: boolean) => {
    const previous = allowRemoteEvaluate
    setAllowRemoteEvaluate(value)
    setSaved('saving')
    try {
      await window.electronAPI.setAllowRemoteEvaluate?.(value)
      flashSaved()
    } catch (err) {
      setAllowRemoteEvaluate(previous)
      setSaved('idle')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const changeRichToolDesc = async (value: boolean) => {
    const previous = richToolDescriptions
    setRichToolDescriptions(value)
    setSaved('saving')
    try {
      await window.electronAPI.setRichToolDescriptions?.(value)
      flashSaved()
    } catch (err) {
      setRichToolDescriptions(previous)
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
          <h2>Settings{userName && <span className="settings-panel__username">— {userName}</span>}</h2>
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

        {/* Reasoning */}
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

        {/* Power */}
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

        {/* Notifications */}
        <section className="settings-section">
          <div className="settings-section__head">
            <BellRing size={16} />
            <h3>Notifications</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Desktop notifications</span>
              <span className="settings-row__hint">
                Alert you when sessions complete or require attention.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={notificationsEnabled ?? false}
              disabled={notificationsEnabled === null}
              onChange={(e) => void changeNotifications(e.target.checked)}
            />
          </label>
        </section>

        {/* Input Behavior */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Keyboard size={16} />
            <h3>Input Behavior</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Auto-capitalisation</span>
              <span className="settings-row__hint">
                Automatically capitalise the first letter of sentences.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={autoCapitalisation ?? false}
              disabled={autoCapitalisation === null}
              onChange={(e) => void changeAutoCapitalisation(e.target.checked)}
            />
          </label>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Spell check</span>
              <span className="settings-row__hint">
                Enable spell checking in text inputs.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={spellCheck ?? false}
              disabled={spellCheck === null}
              onChange={(e) => void changeSpellCheck(e.target.checked)}
            />
          </label>
          <div className="settings-field">
            <span>Send message with</span>
            <select
              className="settings-select"
              value={sendMessageKey ?? 'enter'}
              disabled={sendMessageKey === null}
              onChange={(e) => void changeSendMessageKey(e.target.value)}
            >
              <option value="enter">Enter</option>
              <option value="cmd-enter">{isMac ? 'Cmd' : 'Ctrl'} + Enter</option>
            </select>
          </div>
        </section>

        {/* Tools */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Zap size={16} />
            <h3>Tools & Features</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Browser tool</span>
              <span className="settings-row__hint">
                Enable web browsing capabilities in agent sessions.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={browserToolEnabled ?? false}
              disabled={browserToolEnabled === null}
              onChange={(e) => void changeBrowserTool(e.target.checked)}
            />
          </label>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Local MCP servers</span>
              <span className="settings-row__hint">
                Enable Model Context Protocol servers running on your machine.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={localMcpEnabled ?? false}
              disabled={localMcpEnabled === null}
              onChange={(e) => void changeLocalMcp(e.target.checked)}
            />
          </label>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Rich tool descriptions</span>
              <span className="settings-row__hint">
                Show formatted descriptions and examples for available tools.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={richToolDescriptions ?? false}
              disabled={richToolDescriptions === null}
              onChange={(e) => void changeRichToolDesc(e.target.checked)}
            />
          </label>
        </section>

        {/* Performance */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Radio size={16} />
            <h3>Performance</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Extended prompt cache</span>
              <span className="settings-row__hint">
                Use Claude's prompt caching to reduce latency on repeated requests (when supported).
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={extendedPromptCache ?? false}
              disabled={extendedPromptCache === null}
              onChange={(e) => void changeExtendedCache(e.target.checked)}
            />
          </label>
        </section>

        {/* Security */}
        <section className="settings-section">
          <div className="settings-section__head">
            <Globe size={16} />
            <h3>Security</h3>
          </div>
          <label className="settings-row">
            <div>
              <span className="settings-row__label">Allow remote evaluate</span>
              <span className="settings-row__hint">
                Allow remote agents to execute arbitrary JavaScript expressions via browser_tool.
              </span>
            </div>
            <input
              type="checkbox"
              className="settings-switch"
              checked={allowRemoteEvaluate ?? false}
              disabled={allowRemoteEvaluate === null}
              onChange={(e) => void changeAllowRemoteEval(e.target.checked)}
            />
          </label>
        </section>

        {/* Appearance */}
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

        {/* Export / Import */}
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
      </div>
    </div>
  )
}
