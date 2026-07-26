import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { useAtomValue } from 'jotai'
import {
  Plug,
  Search,
  CheckCircle2,
  KeyRound,
  XCircle,
  CircleDashed,
  PowerOff,
  MessageSquare,
  Bot,
  Smartphone,
  Globe,
  Plus,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  Trash2,
  UserCheck,
} from 'lucide-react'
import type { SourceConnectionStatus } from '@craft-agent/shared/sources/types'
import type {
  MessagingPlatformRuntimeInfo,
  WhatsAppUiEvent,
} from '@craft-agent/shared/types'
import { sourcesAtom } from '../../atoms/sources'
import './IntegrationsPanel.css'

// ────────────────────────────────────────────────
// Source integrations (existing)
// ────────────────────────────────────────────────

type IntegrationsPanelProps = {
  onSelectSource?: (sourceId: string) => void
  selectedSourceId?: string
}

const STATUS_META: Record<
  SourceConnectionStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  connected: { label: 'Connected', icon: CheckCircle2, className: 'is-connected' },
  needs_auth: { label: 'Needs auth', icon: KeyRound, className: 'is-needs-auth' },
  failed: { label: 'Failed', icon: XCircle, className: 'is-failed' },
  untested: { label: 'Untested', icon: CircleDashed, className: 'is-untested' },
  local_disabled: { label: 'Disabled', icon: PowerOff, className: 'is-disabled' },
}

const STATUS_ORDER: SourceConnectionStatus[] = [
  'failed',
  'needs_auth',
  'connected',
  'untested',
  'local_disabled',
]

// ────────────────────────────────────────────────
// Messaging platform definitions
// ────────────────────────────────────────────────

type PlatformId = 'telegram' | 'whatsapp' | 'lark'

interface PlatformDef {
  id: PlatformId
  name: string
  description: string
  color: string
}

const PLATFORMS: PlatformDef[] = [
  { id: 'telegram', name: 'Telegram', description: 'Bot API — send & receive messages via your bot', color: '#26a5e4' },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Baileys adapter — WhatsApp Web automation', color: '#25d366' },
  { id: 'lark', name: 'Lark / Feishu', description: 'Lark bot API — connect your team chat', color: '#3370ff' },
]

const PLATFORM_ICONS: Record<PlatformId, React.ComponentType<{ size?: number }>> = {
  telegram: Bot,
  whatsapp: Smartphone,
  lark: Globe,
}

function platformStateMeta(state: MessagingPlatformRuntimeInfo['state']): {
  label: string
  className: string
} {
  switch (state) {
    case 'connected':
      return { label: 'Connected', className: 'is-connected' }
    case 'connecting':
      return { label: 'Connecting…', className: 'is-connecting' }
    case 'disconnected':
      return { label: 'Disconnected', className: 'is-disconnected' }
    case 'reconnect_required':
      return { label: 'Reconnect required', className: 'is-reconnect' }
    case 'error':
      return { label: 'Error', className: 'is-error' }
    default:
      return { label: 'Unknown', className: 'is-disconnected' }
  }
}

// ────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────

export function IntegrationsPanel({ onSelectSource, selectedSourceId }: IntegrationsPanelProps) {
  const sources = useAtomValue(sourcesAtom)
  const [tab, setTab] = useState<'sources' | 'messaging'>('messaging')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<SourceConnectionStatus | 'all'>('all')

  // ── Messaging state ──────────────────────────
  const [platforms, setPlatforms] = useState<Record<string, MessagingPlatformRuntimeInfo | undefined>>({})
  const [configEnabled, setConfigEnabled] = useState(false)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  // Wizard modal
  const [wizardPlatform, setWizardPlatform] = useState<PlatformId | null>(null)
  // Telegram wizard
  const [tgToken, setTgToken] = useState('')
  const [tgTesting, setTgTesting] = useState(false)
  const [tgTestResult, setTgTestResult] = useState<{ botName?: string; error?: string } | null>(null)
  const [tgSaving, setTgSaving] = useState(false)
  // WhatsApp wizard
  const [waQR, setWaQR] = useState<string | null>(null)
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null)
  const [waPhone, setWaPhone] = useState('')
  const [waConnecting, setWaConnecting] = useState(false)
  const [waStatus, setWaStatus] = useState<string | null>(null)
  const waEventCleanup = useRef<(() => void) | null>(null)
  // Lark wizard
  const [larkAppId, setLarkAppId] = useState('')
  const [larkAppSecret, setLarkAppSecret] = useState('')
  const [larkDomain, setLarkDomain] = useState<'lark' | 'feishu'>('lark')
  const [larkTesting, setLarkTesting] = useState(false)
  const [larkTestResult, setLarkTestResult] = useState<{ botName?: string; error?: string } | null>(null)
  const [larkSaving, setLarkSaving] = useState(false)

  // ── Fetch messaging config ───────────────────
  const fetchConfig = useCallback(async () => {
    setConfigLoading(true)
    setConfigError(null)
    try {
      const cfg = await window.electronAPI.getMessagingConfig()
      if (cfg) {
        setConfigEnabled(cfg.enabled)
        setPlatforms(cfg.runtime ?? {})
      }
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e))
    } finally {
      setConfigLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Listen for real-time platform status updates
  useEffect(() => {
    const cleanup = window.electronAPI.onMessagingPlatformStatus((_wsId, platform, status) => {
      setPlatforms((prev) => ({ ...prev, [platform]: status }))
    })
    return () => cleanup()
  }, [])

  // ── Source integration data ──────────────────
  const userSources = useMemo(() => sources.filter((s) => !s.isBuiltin), [sources])

  const counts = useMemo(() => {
    const map = new Map<SourceConnectionStatus, number>()
    for (const s of userSources) {
      const status = s.config.connectionStatus ?? 'untested'
      map.set(status, (map.get(status) ?? 0) + 1)
    }
    return map
  }, [userSources])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return userSources
      .filter((s) => {
        const status = s.config.connectionStatus ?? 'untested'
        return statusFilter === 'all' || status === statusFilter
      })
      .filter(
        (s) =>
          !q ||
          s.config.name.toLowerCase().includes(q) ||
          s.config.provider.toLowerCase().includes(q) ||
          (s.config.tagline ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const sa = STATUS_ORDER.indexOf(a.config.connectionStatus ?? 'untested')
        const sb = STATUS_ORDER.indexOf(b.config.connectionStatus ?? 'untested')
        if (sa !== sb) return sa - sb
        return a.config.name.localeCompare(b.config.name)
      })
  }, [userSources, search, statusFilter])

  // ── Wizard handlers ──────────────────────────

  const openWizard = useCallback((platformId: PlatformId) => {
    setWizardPlatform(platformId)
    // Reset platform-specific state
    setTgToken('')
    setTgTestResult(null)
    setWaQR(null)
    setWaPairingCode(null)
    setWaPhone('')
    setWaConnecting(false)
    setWaStatus(null)
    setLarkAppId('')
    setLarkAppSecret('')
    setLarkDomain('lark')
    setLarkTestResult(null)
  }, [])

  const closeWizard = useCallback(() => {
    setWizardPlatform(null)
    // Clean up WhatsApp event listener if active
    if (waEventCleanup.current) {
      waEventCleanup.current()
      waEventCleanup.current = null
    }
  }, [])

  // Telegram: test token
  const handleTestTelegram = useCallback(async () => {
    if (!tgToken.trim()) return
    setTgTesting(true)
    setTgTestResult(null)
    try {
      const result = await window.electronAPI.testTelegramToken(tgToken.trim())
      if (result.success) {
        setTgTestResult({ botName: result.botName ?? result.botUsername })
      } else {
        setTgTestResult({ error: result.error ?? 'Test failed' })
      }
    } catch (e) {
      setTgTestResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTgTesting(false)
    }
  }, [tgToken])

  // Telegram: save token
  const handleSaveTelegram = useCallback(async () => {
    if (!tgToken.trim()) return
    setTgSaving(true)
    try {
      await window.electronAPI.saveTelegramToken(tgToken.trim())
      await fetchConfig()
      closeWizard()
    } catch (e) {
      setTgTestResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTgSaving(false)
    }
  }, [tgToken, fetchConfig, closeWizard])

  // WhatsApp: start connection
  const handleStartWhatsApp = useCallback(async () => {
    setWaConnecting(true)
    setWaStatus('Starting WhatsApp connection…')
    try {
      const result = await window.electronAPI.startWhatsAppConnect()
      if (!result.success) {
        setWaStatus('Failed to start WhatsApp connection')
        setWaConnecting(false)
        return
      }
    } catch (e) {
      setWaStatus(e instanceof Error ? e.message : String(e))
      setWaConnecting(false)
      return
    }

    // Listen for WhatsApp events
    const cleanup = window.electronAPI.onWhatsAppEvent((payload) => {
      const event = payload.event
      switch (event.type) {
        case 'qr':
          setWaQR(event.qr)
          setWaPairingCode(null)
          setWaStatus('Scan the QR code with WhatsApp')
          break
        case 'pairing_code':
          setWaPairingCode(event.code)
          setWaQR(null)
          setWaStatus('Use this pairing code in WhatsApp')
          break
        case 'connected':
          setWaStatus(`Connected as ${event.name ?? event.jid ?? 'WhatsApp'}`)
          setWaConnecting(false)
          setWaQR(null)
          setWaPairingCode(null)
          // Re-fetch config to reflect new connection
          setTimeout(() => fetchConfig(), 1000)
          break
        case 'disconnected':
          setWaStatus(event.loggedOut ? 'Logged out' : `Disconnected: ${event.reason ?? 'unknown'}`)
          setWaConnecting(false)
          break
        case 'error':
          setWaStatus(`Error: ${event.message}`)
          setWaConnecting(false)
          break
        case 'unavailable':
          setWaStatus(event.message)
          setWaConnecting(false)
          break
      }
    })
    waEventCleanup.current = cleanup
  }, [fetchConfig])

  // WhatsApp: submit phone number for pairing
  const handleSubmitWhatsAppPhone = useCallback(async () => {
    if (!waPhone.trim()) return
    setWaStatus('Sending pairing request…')
    try {
      await window.electronAPI.submitWhatsAppPhone(waPhone.trim())
      setWaStatus('Pairing code sent. Check your phone.')
    } catch (e) {
      setWaStatus(e instanceof Error ? e.message : String(e))
    }
  }, [waPhone])

  // Lark: test credentials
  const handleTestLark = useCallback(async () => {
    if (!larkAppId.trim() || !larkAppSecret.trim()) return
    setLarkTesting(true)
    setLarkTestResult(null)
    try {
      const result = await window.electronAPI.testLarkCredentials({
        appId: larkAppId.trim(),
        appSecret: larkAppSecret.trim(),
        domain: larkDomain,
      })
      if (result.success) {
        setLarkTestResult({ botName: result.botName })
      } else {
        setLarkTestResult({ error: result.error ?? 'Test failed' })
      }
    } catch (e) {
      setLarkTestResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setLarkTesting(false)
    }
  }, [larkAppId, larkAppSecret, larkDomain])

  // Lark: save credentials
  const handleSaveLark = useCallback(async () => {
    if (!larkAppId.trim() || !larkAppSecret.trim()) return
    setLarkSaving(true)
    try {
      await window.electronAPI.saveLarkCredentials({
        appId: larkAppId.trim(),
        appSecret: larkAppSecret.trim(),
        domain: larkDomain,
      })
      await fetchConfig()
      closeWizard()
    } catch (e) {
      setLarkTestResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setLarkSaving(false)
    }
  }, [larkAppId, larkAppSecret, larkDomain, fetchConfig, closeWizard])

  // Disconnect a platform
  const handleDisconnect = useCallback(async (platformId: PlatformId) => {
    try {
      await window.electronAPI.disconnectMessagingPlatform(platformId)
      await fetchConfig()
    } catch {
      // ignore
    }
  }, [fetchConfig])

  // Forget a platform (remove credentials)
  const handleForget = useCallback(async (platformId: PlatformId) => {
    try {
      await window.electronAPI.forgetMessagingPlatform(platformId)
      await fetchConfig()
    } catch {
      // ignore
    }
  }, [fetchConfig])

  // ── Render platform status card ──────────────
  const renderPlatformCard = (def: PlatformDef) => {
    const runtime = platforms[def.id]
    const configured = runtime?.configured ?? false
    const connected = runtime?.connected ?? false
    const state = runtime?.state ?? 'disconnected'
    const meta = platformStateMeta(state)
    const Icon = PLATFORM_ICONS[def.id]
    const hasError = !!runtime?.lastError

    return (
      <div
        key={def.id}
        className={`int-platform-card ${connected ? 'int-platform-card--connected' : ''}`}
      >
        <div className="int-platform-card__header">
          <div className="int-platform-card__icon" style={{ color: def.color }}>
            <Icon size={24} />
          </div>
          <div className="int-platform-card__info">
            <h3>{def.name}</h3>
            <p>{def.description}</p>
          </div>
          <span className={`int-platform-card__status-dot ${meta.className}`} />
        </div>

        <div className="int-platform-card__body">
          {/* Identity / runtime info */}
          {configured && runtime?.identity && (
            <div className="int-platform-card__identity">
              <UserCheck size={12} />
              <span>{runtime.identity}</span>
            </div>
          )}

          {/* Status badge */}
          <div className="int-platform-card__status-row">
            <span className={`int-platform-card__status-badge ${meta.className}`}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {meta.label}
            </span>
          </div>

          {/* Error */}
          {hasError && (
            <div className="int-platform-card__error">
              <AlertTriangle size={12} />
              <span>{runtime!.lastError}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="int-platform-card__actions">
            {configured ? (
              <>
                {!connected && (
                  <button
                    type="button"
                    className="int-platform-card__btn int-platform-card__btn--primary"
                    onClick={() => handleDisconnect(def.id)}
                  >
                    <RefreshCw size={12} />
                    Reconnect
                  </button>
                )}
                <button
                  type="button"
                  className="int-platform-card__btn int-platform-card__btn--danger"
                  onClick={() => handleForget(def.id)}
                >
                  <Trash2 size={12} />
                  Forget
                </button>
              </>
            ) : (
              <button
                type="button"
                className="int-platform-card__btn int-platform-card__btn--primary"
                onClick={() => openWizard(def.id)}
              >
                <Plus size={12} />
                Connect
              </button>
            )}
            {configured && connected && (
              <span className="int-platform-card__meta">
                Updated {new Date(runtime!.updatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render wizard modal ──────────────────────
  const renderWizard = () => {
    if (!wizardPlatform) return null

    const def = PLATFORMS.find((p) => p.id === wizardPlatform)!
    const Icon = PLATFORM_ICONS[wizardPlatform]

    return (
      <div className="int-wizard-overlay" onClick={closeWizard}>
        <div className="int-wizard" onClick={(e) => e.stopPropagation()}>
          <div className="int-wizard__header">
            <div className="int-wizard__title">
              <Icon size={20} style={{ color: def.color }} />
              <h2>Connect {def.name}</h2>
            </div>
            <button type="button" className="int-wizard__close" onClick={closeWizard}>
              <XCircle size={18} />
            </button>
          </div>

          <div className="int-wizard__body">
            {wizardPlatform === 'telegram' && (
              <div className="int-wizard__form">
                <p className="int-wizard__guide">
                  Create a bot via <a href="https://t.me/botfather" target="_blank" rel="noopener">@BotFather</a> on Telegram, then paste the token here.
                </p>
                <div className="int-wizard__field">
                  <label>Bot Token</label>
                  <input
                    type="password"
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  />
                </div>
                {tgTestResult && (
                  <div className={`int-wizard__result ${tgTestResult.error ? 'int-wizard__result--error' : 'int-wizard__result--ok'}`}>
                    {tgTestResult.error ? (
                      <><AlertTriangle size={14} /><span>{tgTestResult.error}</span></>
                    ) : (
                      <><CheckCircle2 size={14} /><span>Connected as <strong>@{tgTestResult.botName}</strong></span></>
                    )}
                  </div>
                )}
                <div className="int-wizard__actions">
                  <button
                    type="button"
                    className="int-wizard__btn"
                    onClick={handleTestTelegram}
                    disabled={tgTesting || !tgToken.trim()}
                  >
                    {tgTesting ? <Loader2 size={14} className="int-spin" /> : <CheckCircle2 size={14} />}
                    Test Token
                  </button>
                  <button
                    type="button"
                    className="int-wizard__btn int-wizard__btn--primary"
                    onClick={handleSaveTelegram}
                    disabled={tgSaving || !tgToken.trim() || !!tgTestResult?.error}
                  >
                    {tgSaving ? <Loader2 size={14} className="int-spin" /> : <CheckCircle2 size={14} />}
                    Save & Connect
                  </button>
                </div>
              </div>
            )}

            {wizardPlatform === 'whatsapp' && (
              <div className="int-wizard__form">
                <p className="int-wizard__guide">
                  Connect WhatsApp by scanning a QR code with your phone.
                  Optionally enter your phone number for pairing code authentication.
                </p>

                {waConnecting && (
                  <div className="int-wizard__connecting">
                    <Loader2 size={20} className="int-spin" />
                    <span>{waStatus}</span>
                  </div>
                )}

                {waQR && !waConnecting && (
                  <div className="int-wizard__qr">
                    <img src={waQR} alt="WhatsApp QR code" />
                    <p>Scan with WhatsApp on your phone</p>
                  </div>
                )}

                {waPairingCode && !waConnecting && (
                  <div className="int-wizard__pairing-code">
                    <code>{waPairingCode}</code>
                    <p>Enter this code in WhatsApp → Linked Devices</p>
                  </div>
                )}

                {!waConnecting && !waQR && !waPairingCode && (
                  <>
                    <div className="int-wizard__field">
                      <label>Phone number (optional)</label>
                      <input
                        type="tel"
                        value={waPhone}
                        onChange={(e) => setWaPhone(e.target.value)}
                        placeholder="+1234567890"
                      />
                    </div>
                    <div className="int-wizard__actions">
                      <button
                        type="button"
                        className="int-wizard__btn int-wizard__btn--primary"
                        onClick={handleStartWhatsApp}
                      >
                        <Smartphone size={14} />
                        Start Connection
                      </button>
                    </div>
                  </>
                )}

                {waPairingCode && !waConnecting && waPhone.trim() && (
                  <div className="int-wizard__actions" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="int-wizard__btn"
                      onClick={handleSubmitWhatsAppPhone}
                    >
                      <Smartphone size={14} />
                      Resend Pairing Code
                    </button>
                  </div>
                )}

                {waStatus && (
                  <div className="int-wizard__status">
                    <span>{waStatus}</span>
                  </div>
                )}

                {(waQR || waPairingCode) && (
                  <div className="int-wizard__actions" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="int-wizard__btn int-wizard__btn--primary"
                      onClick={() => { fetchConfig(); closeWizard() }}
                      disabled={!platforms[wizardPlatform!]?.configured}
                    >
                      <CheckCircle2 size={14} />
                      {platforms[wizardPlatform!]?.configured ? 'Done — Close' : 'Close'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {wizardPlatform === 'lark' && (
              <div className="int-wizard__form">
                <p className="int-wizard__guide">
                  Create a custom bot in the Lark Developer Console, then enter the app credentials here.
                </p>
                <div className="int-wizard__field">
                  <label>Domain</label>
                  <select value={larkDomain} onChange={(e) => setLarkDomain(e.target.value as 'lark' | 'feishu')}>
                    <option value="lark">Lark (larksuite.com)</option>
                    <option value="feishu">Feishu (feishu.cn)</option>
                  </select>
                </div>
                <div className="int-wizard__field">
                  <label>App ID</label>
                  <input
                    type="text"
                    value={larkAppId}
                    onChange={(e) => setLarkAppId(e.target.value)}
                    placeholder="cli_a12345abcde"
                  />
                </div>
                <div className="int-wizard__field">
                  <label>App Secret</label>
                  <input
                    type="password"
                    value={larkAppSecret}
                    onChange={(e) => setLarkAppSecret(e.target.value)}
                    placeholder="Your app secret"
                  />
                </div>
                {larkTestResult && (
                  <div className={`int-wizard__result ${larkTestResult.error ? 'int-wizard__result--error' : 'int-wizard__result--ok'}`}>
                    {larkTestResult.error ? (
                      <><AlertTriangle size={14} /><span>{larkTestResult.error}</span></>
                    ) : (
                      <><CheckCircle2 size={14} /><span>Connected as <strong>{larkTestResult.botName}</strong></span></>
                    )}
                  </div>
                )}
                <div className="int-wizard__actions">
                  <button
                    type="button"
                    className="int-wizard__btn"
                    onClick={handleTestLark}
                    disabled={larkTesting || !larkAppId.trim() || !larkAppSecret.trim()}
                  >
                    {larkTesting ? <Loader2 size={14} className="int-spin" /> : <CheckCircle2 size={14} />}
                    Test Credentials
                  </button>
                  <button
                    type="button"
                    className="int-wizard__btn int-wizard__btn--primary"
                    onClick={handleSaveLark}
                    disabled={larkSaving || !larkAppId.trim() || !larkAppSecret.trim() || !!larkTestResult?.error}
                  >
                    {larkSaving ? <Loader2 size={14} className="int-spin" /> : <CheckCircle2 size={14} />}
                    Save & Connect
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render ──────────────────────────────────
  return (
    <div className="integrations-panel">
      {/* Header */}
      <div className="integrations-panel__header">
        <div className="integrations-panel__title">
          <Globe size={20} />
          <h2>Integrations</h2>
        </div>
      </div>

      {/* Tabs */}
      <div className="integrations-panel__tabs">
        <button
          type="button"
          className={`integrations-tab ${tab === 'messaging' ? 'is-active' : ''}`}
          onClick={() => setTab('messaging')}
        >
          <MessageSquare size={14} />
          Messaging
        </button>
        <button
          type="button"
          className={`integrations-tab ${tab === 'sources' ? 'is-active' : ''}`}
          onClick={() => setTab('sources')}
        >
          <Plug size={14} />
          Sources
        </button>
      </div>

      {/* ─┄ Messaging tab ╌┄──────────────────── */}
      {tab === 'messaging' && (
        <div className="integrations-panel__messaging">
          {configLoading ? (
            <div className="integrations-panel__loading">
              <Loader2 size={24} className="int-spin" />
              <span>Loading messaging platforms…</span>
            </div>
          ) : configError ? (
            <div className="integrations-panel__error-banner">
              <AlertTriangle size={14} />
              <span>{configError}</span>
            </div>
          ) : (
            <div className="integrations-panel__platforms">
              {PLATFORMS.map(renderPlatformCard)}
            </div>
          )}

          {!configLoading && !configError && (
            <div className="integrations-panel__info">
              <p>
                Messaging platforms let you interact with ARCHstudio agents through your preferred chat apps.
                Configure a platform, then pair it with a session to send and receive messages.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─┄ Sources tab ╌┄─────────────────────── */}
      {tab === 'sources' && (
        <>
          <div className="integrations-panel__search">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search integrations..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="integrations-panel__filters">
            <button
              type="button"
              className={`integrations-chip${statusFilter === 'all' ? ' is-active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All <span>{userSources.length}</span>
            </button>
            {STATUS_ORDER.filter((s) => counts.get(s)).map((status) => {
              const meta = STATUS_META[status]
              const Icon = meta.icon
              return (
                <button
                  key={status}
                  type="button"
                  className={`integrations-chip ${meta.className}${statusFilter === status ? ' is-active' : ''}`}
                  onClick={() => setStatusFilter(status)}
                >
                  <Icon size={13} />
                  {meta.label} <span>{counts.get(status)}</span>
                </button>
              )
            })}
          </div>

          <div className="integrations-panel__grid">
            {visible.length === 0 && (
              <div className="integrations-panel__empty">
                <Plug size={48} />
                <p>{userSources.length === 0 ? 'No integrations configured' : 'Nothing matches this filter'}</p>
              </div>
            )}
            {visible.map((source) => {
              const cfg = source.config
              const status = cfg.connectionStatus ?? 'untested'
              const meta = STATUS_META[status]
              const Icon = meta.icon
              const isSelected = cfg.id === selectedSourceId
              return (
                <button
                  key={cfg.id}
                  type="button"
                  className={`integrations-card${isSelected ? ' is-selected' : ''}${cfg.enabled ? '' : ' is-off'}`}
                  onClick={() => onSelectSource?.(cfg.id)}
                >
                  <div className="integrations-card__top">
                    <span className="integrations-card__icon">
                      {cfg.icon && !cfg.icon.startsWith('http') ? cfg.icon : cfg.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="integrations-card__id">
                      <h3>{cfg.name}</h3>
                      <span className="integrations-card__provider">
                        {cfg.provider} · {cfg.type}
                      </span>
                    </div>
                  </div>
                  {cfg.tagline && <p className="integrations-card__tagline">{cfg.tagline}</p>}
                  <div className="integrations-card__footer">
                    <span className={`integrations-status ${meta.className}`}>
                      <Icon size={13} />
                      {meta.label}
                    </span>
                    {!cfg.enabled && <span className="integrations-card__off">Disabled</span>}
                  </div>
                  {status === 'failed' && cfg.connectionError && (
                    <p className="integrations-card__error" title={cfg.connectionError}>
                      {cfg.connectionError}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Wizard modal */}
      {renderWizard()}
    </div>
  )
}
