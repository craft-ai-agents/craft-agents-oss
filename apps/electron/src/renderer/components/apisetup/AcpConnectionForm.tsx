/**
 * AcpConnectionForm — ACP-specific connection configuration form.
 *
 * Renders:
 *   - A single-line command input with shell tokenization preview
 *   - A dynamic key-value pair editor for optional env vars
 *
 * Does NOT include layout wrappers or action buttons — parent (CredentialsStep)
 * provides layout via StepFormLayout and binds submit via form id "acp-connection-form".
 */

import { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Trash2, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EnvPair {
  id: string
  key: string
  value: string
}

export interface AcpConnectionFormProps {
  /** Called when form is submitted and validation passes */
  onSubmit: (data: { acpCommand: string[]; acpEnv: Record<string, string> }) => void
  /** Pre-fill values for edit mode */
  initialValues?: {
    acpCommand?: string[]
    acpEnv?: Record<string, string>
  }
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
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

  const [commandText, setCommandText] = useState<string>(
    () => initialValues?.acpCommand?.join(' ') ?? ''
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
    onSubmit({ acpCommand: tokens, acpEnv })
  }

  const parsedTokens = tokenizeCommand(commandText)

  return (
    <form id="acp-connection-form" onSubmit={handleSubmit} className="space-y-5">

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
