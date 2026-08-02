import React, { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
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
import { isMac } from '@/lib/platform'
import './SettingsPanel.css'

type SaveState = 'idle' | 'saving' | 'saved'

export function SettingsPanel() {
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
        const [awake, notif, browserTool, sendKey, spell, autoCap, mcp, cache, remote, toolDesc] = await Promise.all([
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

        {/* Simple toggles list */}
        <label className="settings-row">
          <div>
            <span className="settings-row__label">Keep awake while running</span>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={keepAwake ?? false}
            disabled={keepAwake === null}
            onChange={(e) => void changeKeepAwake(e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Desktop notifications</span>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={notificationsEnabled ?? false}
            disabled={notificationsEnabled === null}
            onChange={(e) => void changeNotifications(e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Auto-capitalisation</span>
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
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={spellCheck ?? false}
            disabled={spellCheck === null}
            onChange={(e) => void changeSpellCheck(e.target.checked)}
          />
        </label>

        <div className="settings-row settings-row--select">
          <span className="settings-row__label">Send message with</span>
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

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Browser tool</span>
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
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={richToolDescriptions ?? false}
            disabled={richToolDescriptions === null}
            onChange={(e) => void changeRichToolDesc(e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Extended prompt cache</span>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={extendedPromptCache ?? false}
            disabled={extendedPromptCache === null}
            onChange={(e) => void changeExtendedCache(e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Allow remote evaluate</span>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={allowRemoteEvaluate ?? false}
            disabled={allowRemoteEvaluate === null}
            onChange={(e) => void changeAllowRemoteEval(e.target.checked)}
          />
        </label>

        <label className="settings-row">
          <div>
            <span className="settings-row__label">Compact UI</span>
          </div>
          <input
            type="checkbox"
            className="settings-switch"
            checked={compactUI}
            onChange={(e) => void changeCompactUI(e.target.checked)}
          />
        </label>

        {/* Export / Import */}
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
      </div>
    </div>
  )
}
