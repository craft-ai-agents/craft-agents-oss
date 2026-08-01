import React, { useEffect, useState } from 'react'
import {
  Settings as SettingsIcon,
  Brain,
  Coffee,
  Check,
  SlidersHorizontal,
  Palette,
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
        const [level, awake] = await Promise.all([
          window.electronAPI.getDefaultThinkingLevel(),
          window.electronAPI.getKeepAwakeWhileRunning(),
        ])
        if (cancelled) return
        setThinking(level)
        setKeepAwake(awake)

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
