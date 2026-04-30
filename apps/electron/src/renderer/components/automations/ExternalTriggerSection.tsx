/**
 * ExternalTriggerSection
 *
 * Renders the "External input" panel on the automation detail page for the
 * three external-input event types: WebhookReceive, FileWatch, PollUrl.
 *
 * Renders nothing for other events.
 *
 * Goals:
 *   - Make the trigger immediately *usable* without reading docs.
 *   - For WebhookReceive: show the full trigger URL with copy-to-clipboard
 *     and a curl command users can paste into a terminal to test.
 *   - For FileWatch: show what's being watched at a glance.
 *   - For PollUrl: show URL, cadence, fingerprint mode, and a "next poll" cue.
 *   - Always link to the docs section for deeper learning.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react'
import { Info_Section, Info_Table, Info_Badge, Info_Alert } from '@/components/info'
import { useActiveWorkspace } from '@/context/AppShellContext'
import type { AutomationListItem } from './types'

interface ExternalTriggerSectionProps {
  automation: AutomationListItem
  editActions?: React.ReactNode
}

export function ExternalTriggerSection({ automation, editActions }: ExternalTriggerSectionProps) {
  const { t } = useTranslation()
  void t // reserved for i18n; rendering uses literal strings until keys are added
  const event = automation.event

  if (event === 'WebhookReceive') {
    return <WebhookReceivePanel automation={automation} editActions={editActions} />
  }
  if (event === 'FileWatch') {
    return <FileWatchPanel automation={automation} editActions={editActions} />
  }
  if (event === 'PollUrl') {
    return <PollUrlPanel automation={automation} editActions={editActions} />
  }
  return null
}

// ============================================================================
// WebhookReceive
// ============================================================================

function WebhookReceivePanel({ automation, editActions }: ExternalTriggerSectionProps) {
  const workspace = useActiveWorkspace()
  const triggerInfo = useTriggerServerInfo()

  // Build URL from the live server info when available; fall back to a
  // sensible localhost guess so users still see *some* URL when the server
  // hasn't started yet (e.g. another process bound the port).
  const baseUrl = triggerInfo.url ?? 'http://127.0.0.1:9101'
  const url = automation.slug && workspace?.id
    ? `${baseUrl}/v1/triggers/${encodeURIComponent(workspace.id)}/${encodeURIComponent(automation.slug)}`
    : null

  const allowedMethods = automation.allowedMethods ?? ['POST']
  const primaryMethod = allowedMethods[0] ?? 'POST'

  return (
    <Info_Section
      title="Inbound Webhook"
      description="External services can fire this automation by POSTing to the URL below."
      actions={editActions}
    >
      {!triggerInfo.enabled && (
        <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
          <Info_Alert.Title>Trigger server not running</Info_Alert.Title>
          <Info_Alert.Description>
            The HTTP server that receives webhooks is disabled or failed to start.
            By default it auto-starts on <code>127.0.0.1:9101</code>. Set{' '}
            <code className="font-mono">CRAFT_TRIGGER_PORT</code> to a free port and restart the app,
            or set <code className="font-mono">CRAFT_TRIGGER_PORT=0</code> to keep it off.
          </Info_Alert.Description>
        </Info_Alert>
      )}

      {!automation.slug && (
        <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
          <Info_Alert.Title>No slug configured</Info_Alert.Title>
          <Info_Alert.Description>
            This automation will not fire until you set a <code>slug</code> in automations.json.
          </Info_Alert.Description>
        </Info_Alert>
      )}

      {!automation.secretEnv && (
        <Info_Alert variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
          <Info_Alert.Title>Unauthenticated</Info_Alert.Title>
          <Info_Alert.Description>
            No HMAC secret configured. Anyone who can reach the trigger port can fire this automation.
            Add <code>secretEnv: "CRAFT_WH_..."</code> for production.
          </Info_Alert.Description>
        </Info_Alert>
      )}

      <Info_Table>
        <Info_Table.Row label="Slug">
          <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
            {automation.slug ?? '—'}
          </code>
        </Info_Table.Row>
        <Info_Table.Row label="Allowed methods">
          <div className="flex gap-1.5 flex-wrap">
            {allowedMethods.map((m) => (
              <Info_Badge key={m} color="muted">{m}</Info_Badge>
            ))}
          </div>
        </Info_Table.Row>
        <Info_Table.Row label="HMAC secret">
          {automation.secretEnv ? (
            <Info_Badge color="success">${automation.secretEnv}</Info_Badge>
          ) : (
            <Info_Badge color="muted">none</Info_Badge>
          )}
        </Info_Table.Row>
        {url && (
          <Info_Table.Row label="Trigger URL">
            <CopyableValue value={url} />
          </Info_Table.Row>
        )}
        {url && (
          <Info_Table.Row label="Test (curl)">
            <CopyableValue
              value={buildCurlExample(url, primaryMethod, automation.secretEnv)}
              monospace={false}
              multiline
            />
          </Info_Table.Row>
        )}
      </Info_Table>

    </Info_Section>
  )
}

function buildCurlExample(url: string, method: string, secretEnv: string | undefined): string {
  const lines: string[] = []
  if (secretEnv) {
    lines.push(`# Compute the HMAC and POST. Set $${secretEnv} in your shell first.`)
    lines.push(`BODY='{"hello":"world"}'`)
    lines.push(`SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$${secretEnv}" -hex | cut -d' ' -f2)"`)
    lines.push(`curl -X ${method} "${url}" \\`)
    lines.push(`  -H "Content-Type: application/json" \\`)
    lines.push(`  -H "X-Craft-Signature: $SIG" \\`)
    lines.push(`  -d "$BODY"`)
  } else {
    lines.push(`curl -X ${method} "${url}" \\`)
    lines.push(`  -H "Content-Type: application/json" \\`)
    lines.push(`  -d '{"hello":"world"}'`)
  }
  return lines.join('\n')
}

// ============================================================================
// FileWatch
// ============================================================================

function FileWatchPanel({ automation, editActions }: ExternalTriggerSectionProps) {
  const watchPath = automation.watchPath ?? '<workspace root>'
  const watchGlob = automation.watchGlob ?? '*'
  const changeTypes = automation.watchChangeTypes ?? ['add', 'change', 'remove']
  const debounce = automation.watchDebounceMs ?? 500

  return (
    <Info_Section
      title="File Watch"
      description="Fires when files matching the pattern below are added, modified, or removed."
      actions={editActions}
    >
      <Info_Table>
        <Info_Table.Row label="Watching">
          <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">{watchPath}</code>
        </Info_Table.Row>
        <Info_Table.Row label="Pattern">
          <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">{watchGlob}</code>
        </Info_Table.Row>
        <Info_Table.Row label="Fires on">
          <div className="flex gap-1.5 flex-wrap">
            {changeTypes.map((c) => (
              <Info_Badge key={c} color="muted">{c}</Info_Badge>
            ))}
          </div>
        </Info_Table.Row>
        <Info_Table.Row label="Debounce" value={`${debounce} ms`} />
      </Info_Table>

      <p className="text-xs text-foreground/60 mt-2">
        Available variables in actions: <code className="font-mono">$CRAFT_PATH</code>{' '}
        <code className="font-mono">$CRAFT_RELATIVE_PATH</code>{' '}
        <code className="font-mono">$CRAFT_CHANGE_TYPE</code>{' '}
        <code className="font-mono">$CRAFT_SIZE</code>
      </p>
    </Info_Section>
  )
}

// ============================================================================
// PollUrl
// ============================================================================

function PollUrlPanel({ automation, editActions }: ExternalTriggerSectionProps) {
  const url = automation.pollUrl ?? '—'
  const interval = automation.pollIntervalSec ?? 300
  const method = automation.pollMethod ?? 'GET'
  const fingerprint = automation.pollFingerprint ?? 'body'

  return (
    <Info_Section
      title="URL Poll"
      description="Polls a URL on a cadence and fires when the response fingerprint changes."
      actions={editActions}
    >
      <Info_Table>
        <Info_Table.Row label="URL">
          <CopyableValue value={url} />
        </Info_Table.Row>
        <Info_Table.Row label="Method">
          <Info_Badge color="muted">{method}</Info_Badge>
        </Info_Table.Row>
        <Info_Table.Row label="Interval" value={formatInterval(interval)} />
        <Info_Table.Row label="Fingerprint">
          <Info_Badge color="muted">{fingerprint}</Info_Badge>
          <span className="text-xs text-foreground/60 ml-2">{describeFingerprint(fingerprint)}</span>
        </Info_Table.Row>
        {automation.pollAuth && (
          <Info_Table.Row label="Auth">
            <Info_Badge color="success">{automation.pollAuth.type}</Info_Badge>
          </Info_Table.Row>
        )}
      </Info_Table>

      <p className="text-xs text-foreground/60 mt-2">
        Available variables: <code className="font-mono">$CRAFT_URL</code>{' '}
        <code className="font-mono">$CRAFT_STATUS</code>{' '}
        <code className="font-mono">$CRAFT_FINGERPRINT</code>{' '}
        <code className="font-mono">$CRAFT_PREVIOUS_FINGERPRINT</code>{' '}
        <code className="font-mono">$CRAFT_BODY</code>
      </p>
    </Info_Section>
  )
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${(seconds / 3600).toFixed(1)} hr`
}

function describeFingerprint(kind: string): string {
  switch (kind) {
    case 'body': return 'fires when response body changes'
    case 'etag': return 'fires when ETag header changes'
    case 'last-modified': return 'fires when Last-Modified header changes'
    case 'status': return 'fires when HTTP status code changes'
    default: return ''
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Subscribe to live trigger HTTP server status. Polls the main process on
 * mount + every 30 seconds afterwards. Cheap (no payload to speak of) and
 * keeps the UI accurate even if the server starts late or restarts.
 */
function useTriggerServerInfo(): { enabled: boolean; url: string | null } {
  const [info, setInfo] = React.useState<{ enabled: boolean; url: string | null }>({
    enabled: false,
    url: null,
  })

  React.useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const result = await window.electronAPI.getTriggerServerInfo()
        if (!cancelled) setInfo(result)
      } catch {
        if (!cancelled) setInfo({ enabled: false, url: null })
      }
    }
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return info
}

interface CopyableValueProps {
  value: string
  monospace?: boolean
  multiline?: boolean
}

function CopyableValue({ value, monospace = true, multiline = false }: CopyableValueProps) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = React.useCallback(() => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [value])

  if (multiline) {
    return (
      <div className="flex items-start gap-2 w-full">
        <pre className={`text-xs ${monospace ? 'font-mono' : ''} bg-foreground/5 px-2 py-1.5 rounded flex-1 overflow-x-auto whitespace-pre-wrap`}>
          {value}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs text-foreground/70 hover:text-foreground inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-foreground/10"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <code className={`text-xs ${monospace ? 'font-mono' : ''} bg-foreground/5 px-1.5 py-0.5 rounded break-all`}>
        {value}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="text-xs text-foreground/70 hover:text-foreground inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-foreground/10"
        title="Copy"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}

// Suppress unused-import warning if some lucide icons end up unused after edits
void ExternalLink
