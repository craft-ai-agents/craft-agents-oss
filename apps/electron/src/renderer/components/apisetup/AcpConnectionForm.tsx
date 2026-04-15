/**
 * AcpConnectionForm — ACP-specific connection configuration form.
 *
 * Renders:
 *   - A preset selector row (Claude, Cursor, Codex, Gemini, Custom)
 *   - A single-line command input with shell tokenization preview
 *   - A dynamic key-value pair editor for optional env vars
 *
 * Does NOT include layout wrappers or action buttons — parent (CredentialsStep)
 * provides layout via StepFormLayout and binds submit via form id "acp-connection-form".
 */

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Trash2, Plus, Terminal } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// Provider icons
import claudeIcon from '@/assets/provider-icons/claude.svg'
import openaiIcon from '@/assets/provider-icons/openai.svg'
import googleIcon from '@/assets/provider-icons/google.svg'

// ─────────────────────────────────────────────────────────────────────────────
// Shell tokenizer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokenize a shell-like command string into an array.
 *
 * Rules:
 *   - Split on whitespace
 *   - "foo bar" → one token (double-quote stripped)
 *   - 'foo bar' → one token (single-quote stripped)
 *   - Empty input → empty array
 *   - Does NOT handle backslash escape sequences
 */
export function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = []
  const re = /("[^"]*"|'[^']*'|[^\s"']+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) {
    const tok = m[1]
    if (tok.startsWith('"') && tok.endsWith('"')) {
      tokens.push(tok.slice(1, -1))
    } else if (tok.startsWith("'") && tok.endsWith("'")) {
      tokens.push(tok.slice(1, -1))
    } else {
      tokens.push(tok)
    }
  }
  return tokens
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

interface AcpPreset {
  id: string
  /** Display name — also used as connection name */
  name: string
  /** Pre-filled command string */
  command: string
  /** Static SVG import (undefined = show Terminal icon) */
  iconSrc?: string
  /** i18n key for the prerequisite hint line */
  requiresKey: string
}

const ACP_PRESETS: AcpPreset[] = [
  {
    id: 'claude',
    name: 'Claude',
    command: 'npx -y @zed-industries/claude-agent-acp',
    iconSrc: claudeIcon,
    requiresKey: 'onboarding.credentials.acpPresetRequiresClaude',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor agent acp',
    iconSrc: undefined,
    requiresKey: 'onboarding.credentials.acpPresetRequiresCursor',
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'npx -y @openai/codex-acp',
    iconSrc: openaiIcon,
    requiresKey: 'onboarding.credentials.acpPresetRequiresCodex',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    command: 'gemini --experimental-acp',
    iconSrc: googleIcon,
    requiresKey: 'onboarding.credentials.acpPresetRequiresGemini',
  },
  {
    id: 'custom',
    name: 'Custom',
    command: '',
    iconSrc: undefined,
    requiresKey: 'onboarding.credentials.acpPresetCustomHint',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EnvPair {
  id: string
  key: string
  value: string
}

export interface AcpConnectionFormProps {
  /** Called when form is submitted and validation passes */
  onSubmit: (data: { acpCommand: string[]; acpEnv: Record<string, string>; presetName?: string }) => void
  /** Pre-fill values for edit mode */
  initialValues?: {
    acpCommand?: string[]
    acpEnv?: Record<string, string>
  }
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset card
// ─────────────────────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  selected,
  onClick,
  disabled,
}: {
  preset: AcpPreset
  selected: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-center",
        "transition-colors cursor-pointer select-none min-w-[72px]",
        selected
          ? "border-primary bg-primary/8 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
        disabled && "opacity-50 pointer-events-none"
      )}
    >
      <div className="size-6 flex items-center justify-center shrink-0">
        {preset.iconSrc ? (
          <img src={preset.iconSrc} alt={preset.name} className="size-5 object-contain" />
        ) : (
          <Terminal className="size-4" />
        )}
      </div>
      <span className="text-xs font-medium leading-none">{preset.name}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AcpConnectionForm({
  onSubmit,
  initialValues,
  status,
  errorMessage,
}: AcpConnectionFormProps) {
  const { t } = useTranslation()

  // Try to match initial command to a preset so edit mode highlights the right card
  const detectInitialPreset = (): string => {
    if (!initialValues?.acpCommand?.length) return 'custom'
    const cmdStr = initialValues.acpCommand.join(' ')
    const match = ACP_PRESETS.find(p => p.command && cmdStr === p.command)
    return match?.id ?? 'custom'
  }

  const [selectedPresetId, setSelectedPresetId] = useState<string>(detectInitialPreset)

  const [commandText, setCommandText] = useState<string>(
    // Re-quote tokens that contain spaces so round-trip edit preserves semantics
    () => initialValues?.acpCommand
      ?.map(tok => tok.includes(' ') ? `"${tok}"` : tok)
      .join(' ') ?? ''
  )
  const [commandError, setCommandError] = useState<string>('')

  const [envPairs, setEnvPairs] = useState<EnvPair[]>(
    () => Object.entries(initialValues?.acpEnv ?? {}).map(([k, v]) => ({
      id: crypto.randomUUID(),
      key: k,
      value: v,
    }))
  )

  // Derived: which envPair ids have duplicate keys
  const duplicateKeys = new Set(
    envPairs
      .map(p => p.key.trim())
      .filter((k, i, arr) => k !== '' && arr.indexOf(k) !== i)
  )

  // ── Preset selection ──

  const handleSelectPreset = useCallback((preset: AcpPreset) => {
    setSelectedPresetId(preset.id)
    // Only overwrite the command if preset has one (Custom leaves it as-is)
    if (preset.command) {
      setCommandText(preset.command)
      if (commandError) setCommandError('')
    }
  }, [commandError])

  // ── Env pair helpers ──

  const addEnvPair = useCallback(() => {
    setEnvPairs(prev => [...prev, { id: crypto.randomUUID(), key: '', value: '' }])
  }, [])

  const removeEnvPair = useCallback((id: string) => {
    setEnvPairs(prev => prev.filter(p => p.id !== id))
  }, [])

  const updateEnvKey = useCallback((id: string, key: string) => {
    setEnvPairs(prev => prev.map(p => p.id === id ? { ...p, key } : p))
  }, [])

  const updateEnvValue = useCallback((id: string, value: string) => {
    setEnvPairs(prev => prev.map(p => p.id === id ? { ...p, value } : p))
  }, [])

  // ── Submit ──

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const tokens = tokenizeCommand(commandText)
    if (tokens.length === 0) {
      setCommandError(t('onboarding.credentials.acpCommandRequired'))
      return
    }
    setCommandError('')
    const acpEnv: Record<string, string> = Object.fromEntries(
      envPairs
        .filter(p => p.key.trim() !== '')
        .map(p => [p.key.trim(), p.value])
    )
    const selectedPreset = ACP_PRESETS.find(p => p.id === selectedPresetId)
    const presetName = selectedPreset && selectedPreset.id !== 'custom'
      ? selectedPreset.name
      : undefined
    onSubmit({ acpCommand: tokens, acpEnv, presetName })
  }

  const parsedTokens = tokenizeCommand(commandText)
  const activePreset = ACP_PRESETS.find(p => p.id === selectedPresetId)

  return (
    <form id="acp-connection-form" onSubmit={handleSubmit} className="space-y-5">

      {/* ── Preset selector ── */}
      <div className="space-y-2">
        <Label>{t('onboarding.credentials.acpPresetLabel')}</Label>
        <div className="flex gap-2 flex-wrap">
          {ACP_PRESETS.map(preset => (
            <PresetCard
              key={preset.id}
              preset={preset}
              selected={selectedPresetId === preset.id}
              onClick={() => handleSelectPreset(preset)}
              disabled={status === 'validating'}
            />
          ))}
        </div>
        {/* Requirement hint for selected preset */}
        {activePreset && (
          <p className="text-xs text-muted-foreground">
            {t(activePreset.requiresKey)}
          </p>
        )}
      </div>

      {/* ── Command input ── */}
      <div className="space-y-1.5">
        <Label htmlFor="acp-command">
          {t('onboarding.credentials.acpCommandLabel')}
          <span className="text-destructive ml-0.5">*</span>
        </Label>
        <Input
          id="acp-command"
          value={commandText}
          onChange={e => {
            setCommandText(e.target.value)
            // If user edits the command, deselect named presets → switch to Custom
            const typed = e.target.value
            const match = ACP_PRESETS.find(p => p.command && p.id !== 'custom' && typed === p.command)
            setSelectedPresetId(match?.id ?? 'custom')
            if (commandError) setCommandError('')
          }}
          placeholder={t('onboarding.credentials.acpCommandPlaceholder')}
          className={cn(commandError ? "border-destructive focus-visible:ring-destructive" : "")}
          disabled={status === 'validating'}
          autoFocus
        />

        {/* Token preview */}
        {commandText && (
          <p className="text-xs text-muted-foreground font-mono leading-relaxed">
            {parsedTokens.length > 0
              ? parsedTokens.map(tok => `"${tok}"`).join(' ')
              : <span className="text-destructive">{t('onboarding.credentials.acpCommandRequired')}</span>
            }
          </p>
        )}

        {/* Validation error */}
        {commandError && (
          <p className="text-xs text-destructive">{commandError}</p>
        )}

        {/* Hint */}
        <p className="text-xs text-muted-foreground">
          {t('onboarding.credentials.acpCommandHint')}
        </p>
      </div>

      {/* ── Env vars ── */}
      <div className="space-y-2">
        <Label>{t('onboarding.credentials.acpEnvLabel')}</Label>

        {envPairs.map((pair) => (
          <div key={pair.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <Input
                value={pair.key}
                onChange={e => updateEnvKey(pair.id, e.target.value)}
                placeholder={t('onboarding.credentials.acpEnvKeyPlaceholder')}
                className={cn(
                  "flex-1 font-mono text-sm",
                  duplicateKeys.has(pair.key.trim()) ? "border-amber-500 focus-visible:ring-amber-500" : ""
                )}
                disabled={status === 'validating'}
              />
              <span className="text-muted-foreground text-sm">=</span>
              <Input
                value={pair.value}
                onChange={e => updateEnvValue(pair.id, e.target.value)}
                placeholder={t('onboarding.credentials.acpEnvValuePlaceholder')}
                className="flex-1 font-mono text-sm"
                disabled={status === 'validating'}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeEnvPair(pair.id)}
                disabled={status === 'validating'}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            {duplicateKeys.has(pair.key.trim()) && (
              <p className="text-xs text-amber-500 pl-1">
                {t('onboarding.credentials.acpEnvDuplicateKey')}
              </p>
            )}
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2 text-muted-foreground border-dashed"
          onClick={addEnvPair}
          disabled={status === 'validating'}
        >
          <Plus className="size-3.5" />
          {t('onboarding.credentials.acpEnvAddButton')}
        </Button>
      </div>

      {/* ── Server-side error ── */}
      {status === 'error' && errorMessage && (
        <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
          {errorMessage}
        </div>
      )}
    </form>
  )
}
