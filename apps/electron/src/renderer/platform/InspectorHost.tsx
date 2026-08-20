/**
 * InspectorHost (W1 unified shell, spec S-03 §3.1/§3.3) — right-side
 * collapsible inspector: a 48px section rail (always visible) plus one
 * 320px inspector panel.
 *
 * Behavior contract (S-03 §3.3, implemented by `inspector-model.ts`):
 * clicking an inactive section icon opens the panel with that section;
 * clicking the icon of the section already shown hides the panel.
 * Visibility and active section persist via KEYS.inspectorVisible /
 * KEYS.inspectorSection (`atoms/unified-shell.ts`).
 *
 * W1 scope: the `info` section is live (focused-surface properties derived
 * from panel-stack + NavigationContext); `agent`/`outline`/`backlinks` render
 * i18n empty states — their content lands with the Knowledge workspace (W2).
 * Mounted by `WorkspaceSurfaceHost` (platform/index.tsx) — rendered only when
 * the two-key Workbench rollout is enabled.
 */
import { useEffect, useState } from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Bot, Info, Link2, ListTree, X, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
import {
  focusedPanelIdAtom,
  focusedPanelRouteAtom,
  getPanelTypeFromRoute,
  parseSessionIdFromRoute,
} from '@/atoms/panel-stack'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import {
  inspectorSectionAtom,
  inspectorVisibleAtom,
  type InspectorSectionId,
} from '@/atoms/unified-shell'
import { selectedConnectionAtom } from '@/atoms/connections'
import { sanitizeConnectionBindingRows } from '@/pages/connections-list'
import { errorMessage } from '@/pages/connections-ui'
import { isConnectionsNavigation, useNavigationState } from '@/contexts/NavigationContext'
import { cn } from '@/lib/utils'
import { getSessionTitle } from '@/utils/session'
import { RADIUS_INNER } from '@/components/app-shell/panel-constants'
import { projectConnectionInspector } from './connection-inspector-model'
import {
  INSPECTOR_LIVE_SECTIONS,
  INSPECTOR_SECTION_IDS,
  normalizeInspectorSection,
  resolveInspectorToggle,
} from './inspector-model'
import { panelTypeToSurfaceKind } from './surface-tab-model'

const INSPECTOR_PANEL_WIDTH = 320
const INSPECTOR_RAIL_WIDTH = 48

const SECTION_ICONS: Record<InspectorSectionId, LucideIcon> = {
  info: Info,
  agent: Bot,
  outline: ListTree,
  backlinks: Link2,
}

// -----------------------------------------------------------------------------
// Info section (live in W1) — properties of the focused panel's surface.
// -----------------------------------------------------------------------------

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        {label}
      </span>
      <span className={cn('break-all text-[12px] text-foreground/90', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </div>
  )
}

function ConnectionInfoSection() {
  const { t } = useTranslation()
  const selected = useAtomValue(selectedConnectionAtom)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [consumers, setConsumers] = useState<Array<{ consumerId: string; status: string }>>([])
  const [testLogin, setTestLogin] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => {
    if (!selected) {
      setConsumers([])
      setTestLogin('')
      setActionError(null)
      return
    }
    const listConnectionBindings = window.electronAPI?.workgraph?.listConnectionBindings
    if (typeof listConnectionBindings !== 'function') {
      setConsumers([])
      return
    }
    let stale = false
    listConnectionBindings({ workspaceId: selected.workspaceId, connectionId: selected.id })
      .then((raw) => {
        if (stale) return
        setConsumers(sanitizeConnectionBindingRows(raw).map((row) => ({
          consumerId: row.consumerId,
          status: row.purpose,
        })))
      })
      .catch((err) => {
        if (!stale) setActionError(errorMessage(err))
      })
    return () => {
      stale = true
    }
  }, [selected])
  if (!selected) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Info className="h-6 w-6 text-muted-foreground/40" />
        <span className="text-[13px] font-medium text-foreground/80">
          {t('inspector.empty.connections.title')}
        </span>
        <span className="text-[12px] leading-relaxed text-muted-foreground/60">
          {t('inspector.empty.connections.body')}
        </span>
      </div>
    )
  }
  const fields = projectConnectionInspector(selected)
  const workspaceId = selected.workspaceId
  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow label={t('inspector.field.provider')} value={fields.provider} />
      <InfoRow label={t('inspector.field.storageMode')} value={fields.storageMode} mono />
      <InfoRow label={t('inspector.field.credentialRef')} value={fields.credentialRef} mono />
      <InfoRow label={t('inspector.field.scopes')} value={fields.scopes} mono />
      {testLogin ? <InfoRow label={t('inspector.field.testLogin')} value={testLogin} mono /> : null}
      {consumers.length > 0 ? (
        <InfoRow
          label={t('inspector.field.consumers')}
          value={consumers.map((row) => `${row.consumerId}: ${row.status}`).join(', ')}
        />
      ) : null}
      {actionError ? (
        <p className="px-3 py-2 text-[12px]" data-testid="connections-inspector-error">{actionError}</p>
      ) : null}
      <div className="flex flex-wrap gap-1 px-3 py-2">
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const testConnection = window.electronAPI?.workgraph?.testConnection
            if (!workspaceId || typeof testConnection !== 'function') return
            try {
              setActionError(null)
              const result = await testConnection({ workspaceId, connectionId: selected.id })
              setTestLogin(result.login)
            } catch (err) {
              setActionError(errorMessage(err))
            }
          }}
        >
          {t('connections.test')}
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-[12px]"
          onClick={async () => {
            const repairConnection = window.electronAPI?.workgraph?.repairConnection
            if (!workspaceId || typeof repairConnection !== 'function') return
            try {
              setActionError(null)
              const result = await repairConnection({ workspaceId, connectionId: selected.id })
              setConsumers(result.consumers)
            } catch (err) {
              setActionError(errorMessage(err))
            }
          }}
        >
          {t('connections.repair')}
        </button>
        {confirmRotate ? (
          <>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={async () => {
                const rotateConnection = window.electronAPI?.workgraph?.rotateConnection
                if (!workspaceId || typeof rotateConnection !== 'function') return
                try {
                  setActionError(null)
                  const result = await rotateConnection({ workspaceId, connectionId: selected.id })
                  setConsumers(result.consumers)
                  setConfirmRotate(false)
                } catch (err) {
                  setActionError(errorMessage(err))
                }
              }}
            >
              {t('connections.rotateConfirm')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-[12px]"
              onClick={() => setConfirmRotate(false)}
            >
              {t('connections.rotateCancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded border px-2 py-1 text-[12px]"
            onClick={() => setConfirmRotate(true)}
          >
            {t('connections.rotate')}
          </button>
        )}
      </div>
    </div>
  )
}

function InfoSection() {
  const { t } = useTranslation()
  const route = useAtomValue(focusedPanelRouteAtom)
  const panelId = useAtomValue(focusedPanelIdAtom)
  const navState = useNavigationState()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)

  if (isConnectionsNavigation(navState)) {
    return <ConnectionInfoSection />
  }

  const sessionId = route ? parseSessionIdFromRoute(route) : null
  const panelType = route ? getPanelTypeFromRoute(route) : null
  const surfaceKind = panelType ? panelTypeToSurfaceKind(panelType) : null
  const sessionMeta = sessionId ? sessionMetaMap.get(sessionId) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col divide-y divide-foreground/5 overflow-y-auto">
      <InfoRow
        label={t('inspector.field.title')}
        value={sessionMeta ? getSessionTitle(sessionMeta) : t('surfaceTabs.untitled')}
      />
      <InfoRow
        label={t('inspector.field.kind')}
        value={surfaceKind ?? panelType ?? '—'}
        mono
      />
      <InfoRow label={t('inspector.field.navigator')} value={navState.navigator} mono />
      <InfoRow label={t('inspector.field.session')} value={sessionId ?? '—'} mono />
      <InfoRow label={t('inspector.field.panel')} value={panelId ?? '—'} mono />
      <InfoRow label={t('inspector.field.route')} value={route ?? '—'} mono />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Empty sections (agent/outline/backlinks) — content arrives with W2 (S-03 §3.3).
// -----------------------------------------------------------------------------

function EmptySection({ section }: { section: InspectorSectionId }) {
  const { t } = useTranslation()
  const Icon = SECTION_ICONS[section]
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
      <span className="text-[13px] font-medium text-foreground/80">
        {t(`inspector.empty.${section}.title`)}
      </span>
      <span className="text-[12px] leading-relaxed text-muted-foreground/60">
        {t(`inspector.empty.${section}.body`)}
      </span>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Host: 320px panel (when visible) + 48px section rail (always visible).
// -----------------------------------------------------------------------------

export function InspectorHost() {
  const { t } = useTranslation()
  const [visible, setVisible] = useAtom(inspectorVisibleAtom)
  const [sectionRaw, setSection] = useAtom(inspectorSectionAtom)
  // Persisted values can be arbitrary (older builds); validated on read.
  const section = normalizeInspectorSection(sectionRaw)

  const handleSectionClick = (clicked: InspectorSectionId) => {
    const next = resolveInspectorToggle({ visible, section }, clicked)
    setVisible(next.visible)
    setSection(next.section)
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      {visible && (
        <div
          className="flex h-full flex-col overflow-hidden bg-background shadow-middle"
          style={{ width: INSPECTOR_PANEL_WIDTH, borderRadius: RADIUS_INNER }}
        >
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-foreground/5 pl-3 pr-2">
            <span className="truncate text-[13px] font-medium">{t(`inspector.${section}`)}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('inspector.hide')}
                  onClick={() => setVisible(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-[6px] text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t('inspector.hide')}</TooltipContent>
            </Tooltip>
          </div>
          {INSPECTOR_LIVE_SECTIONS.includes(section) ? (
            <InfoSection />
          ) : (
            <EmptySection section={section} />
          )}
        </div>
      )}
      <div
        className="flex h-full shrink-0 flex-col items-center gap-0.5 py-2"
        style={{ width: INSPECTOR_RAIL_WIDTH }}
      >
        {INSPECTOR_SECTION_IDS.map((sectionId) => {
          const Icon = SECTION_ICONS[sectionId]
          const active = visible && section === sectionId
          return (
            <Tooltip key={sectionId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t(`inspector.${sectionId}`)}
                  aria-pressed={active}
                  onClick={() => handleSectionClick(sectionId)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{t(`inspector.${sectionId}`)}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
