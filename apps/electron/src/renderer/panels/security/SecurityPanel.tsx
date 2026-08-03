import React, { useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { ShieldCheck, ShieldAlert, KeyRound, Compass, MessageCircleQuestion, Zap } from 'lucide-react'
import type { PermissionMode } from '@archstudio/shared/agent/mode-types'
import type { CredentialHealthStatus } from '@archstudio/shared/credentials/types'
import { sessionMetaMapAtom } from '../../atoms/sessions'
import { sourcesAtom } from '../../atoms/sources'
import './SecurityPanel.css'

const MODE_META: Record<
  PermissionMode,
  { label: string; blurb: string; icon: typeof Compass; className: string }
> = {
  safe: {
    label: 'Explore',
    blurb: 'Read-only. Blocks writes, never prompts.',
    icon: Compass,
    className: 'is-safe',
  },
  ask: {
    label: 'Ask',
    blurb: 'Prompts before any write or command.',
    icon: MessageCircleQuestion,
    className: 'is-ask',
  },
  'allow-all': {
    label: 'Execute',
    blurb: 'Runs everything without prompting.',
    icon: Zap,
    className: 'is-execute',
  },
}

const MODE_ORDER: PermissionMode[] = ['safe', 'ask', 'allow-all']

export function SecurityPanel() {
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const sources = useAtomValue(sourcesAtom)
  const [health, setHealth] = useState<CredentialHealthStatus | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .getCredentialHealth()
      .then((status) => {
        if (!cancelled) setHealth(status)
      })
      .catch((err: unknown) => {
        if (!cancelled) setHealthError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** How many live sessions sit in each permission mode — the real exposure surface. */
  const modeCounts = useMemo(() => {
    const counts = new Map<PermissionMode, number>()
    for (const meta of metaMap.values()) {
      if (meta.hidden || meta.isArchived) continue
      const mode = (meta.permissionMode ?? 'ask') as PermissionMode
      if (!MODE_ORDER.includes(mode)) continue
      counts.set(mode, (counts.get(mode) ?? 0) + 1)
    }
    return counts
  }, [metaMap])

  const authIssues = useMemo(
    () =>
      sources.filter(
        (s) =>
          !s.isBuiltin &&
          s.config.enabled &&
          (s.config.connectionStatus === 'needs_auth' || s.config.connectionStatus === 'failed'),
      ),
    [sources],
  )

  const executeCount = modeCounts.get('allow-all') ?? 0

  const storeOk = health?.healthy === true && !healthError
  const problems = (health?.issues.length ?? 0) + authIssues.length + (healthError ? 1 : 0)

  return (
    <div className="security-panel">
      <div className="security-panel__header">
        <div className="security-panel__title">
          {problems === 0 ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          <h2>Security</h2>
        </div>
        <span className={`security-panel__verdict${problems === 0 ? ' is-ok' : ' is-warn'}`}>
          {problems === 0 ? 'All clear' : `${problems} to review`}
        </span>
      </div>

      <div className="security-panel__body">
        <section className="security-section">
          <h3>Credential store</h3>
          {healthError && <div className="security-issue is-error">{healthError}</div>}
          {!healthError && health === null && <div className="security-muted">Checking…</div>}
          {storeOk && (
            <div className="security-issue is-ok">
              <ShieldCheck size={14} />
              Credential store is healthy and encrypted at rest.
            </div>
          )}
          {health?.issues.map((issue, i) => (
            <div key={i} className="security-issue is-error">
              <KeyRound size={14} />
              <div>
                <strong>{issue.type}</strong>
                <p>{issue.message}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="security-section">
          <h3>Permission exposure</h3>
          <p className="security-section__lead">
            Active sessions grouped by what they're allowed to do without asking.
          </p>
          <div className="security-modes">
            {MODE_ORDER.map((mode) => {
              const meta = MODE_META[mode]
              const Icon = meta.icon
              const count = modeCounts.get(mode) ?? 0
              return (
                <div key={mode} className={`security-mode ${meta.className}${count ? '' : ' is-empty'}`}>
                  <div className="security-mode__top">
                    <Icon size={16} />
                    <span className="security-mode__label">{meta.label}</span>
                    <span className="security-mode__count">{count}</span>
                  </div>
                  <p>{meta.blurb}</p>
                </div>
              )
            })}
          </div>
          {executeCount > 0 && (
            <div className="security-issue is-warn">
              <ShieldAlert size={14} />
              <div>
                <strong>
                  {executeCount} session{executeCount === 1 ? '' : 's'} in Execute mode
                </strong>
                <p>These run commands and write files without prompting. Review if unexpected.</p>
              </div>
            </div>
          )}
        </section>

        <section className="security-section">
          <h3>Integration access</h3>
          {authIssues.length === 0 ? (
            <div className="security-issue is-ok">
              <ShieldCheck size={14} />
              Every enabled integration is authenticated.
            </div>
          ) : (
            authIssues.map((source) => (
              <div key={source.config.id} className="security-issue is-warn">
                <KeyRound size={14} />
                <div>
                  <strong>{source.config.name}</strong>
                  <p>
                    {source.config.connectionStatus === 'needs_auth'
                      ? 'Needs authentication — the agent cannot reach this source.'
                      : source.config.connectionError || 'Connection failed.'}
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
