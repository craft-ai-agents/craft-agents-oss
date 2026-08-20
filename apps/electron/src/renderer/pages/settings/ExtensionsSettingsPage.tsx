import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Blocks,
  CheckCircle2,
  RefreshCw,
  Shield,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
} from 'lucide-react'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { Spinner } from '@craft-agent/ui'
import { navigate, routes } from '@/lib/navigate'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type {
  CatalogCategory,
  ExtensionPermission,
  ExtensionRecord,
  ExtensionRuntime,
  ExtensionsListInstalledResult,
} from '@craft-agent/shared/extensions/browser'
import {
  CATALOG_CATEGORIES,
  HIGH_RISK_PERMISSIONS,
  RUNTIME_PLACEMENT,
} from '@craft-agent/shared/extensions/browser'
import { useActiveWorkspace } from '@/context/AppShellContext'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'extensions',
}

type SectionId = 'installed' | 'updates' | 'permissions' | 'disabled'
type CategoryFilter = CatalogCategory | 'all'

const SECTIONS: SectionId[] = ['installed', 'updates', 'permissions', 'disabled']


function ExtensionCard({
  name,
  version,
  description,
  runtime,
  category,
  permissions,
  worksIn,
  installTarget,
  status,
  readOnly,
  busy,
  onToggle,
}: {
  name: string
  version: string
  description?: string
  runtime: ExtensionRuntime
  category: string
  permissions: ExtensionPermission[]
  worksIn: string[]
  installTarget?: string
  status: string
  readOnly?: boolean
  busy?: boolean
  onToggle: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const enabled =
    status === 'enabled' || status === 'installed' || status === 'update-available'

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-background/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{name}</h3>
            <span className="text-xs opacity-60">v{version}</span>
            <span className="text-[10px] uppercase tracking-wide opacity-70 border rounded px-1.5 py-0.5">
              {t(`extensions.status.${status}`, { defaultValue: status })}
            </span>
          </div>
          <div className="mt-1 text-xs opacity-70 flex flex-wrap gap-2">
            <span>{t(`extensions.category.${category}`, { defaultValue: category })}</span>
            {readOnly ? (
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {t('extensions.card.readOnly', { defaultValue: 'projection' })}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggle(!enabled)}
          className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1 hover:bg-muted disabled:opacity-50 shrink-0"
          title={
            enabled
              ? t('extensions.action.disable', { defaultValue: 'Disable' })
              : t('extensions.action.enable', { defaultValue: 'Enable' })
          }
        >
          {enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
          {enabled
            ? t('extensions.action.disable', { defaultValue: 'Disable' })
            : t('extensions.action.enable', { defaultValue: 'Enable' })}
        </button>
      </div>

      {description ? <p className="text-sm opacity-80 line-clamp-3">{description}</p> : null}

      <div className="grid gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <RuntimeBadge runtime={runtime} />
          {installTarget ? (
            <span className="opacity-70">
              {t('extensions.card.installTarget', { defaultValue: 'Install to' })}:{' '}
              <span className="font-medium">
                {t(`extensions.installTarget.${installTarget}`, { defaultValue: installTarget })}
              </span>
            </span>
          ) : null}
        </div>
        <div>
          <div className="opacity-70 mb-1">
            {t('extensions.card.worksIn', { defaultValue: 'Works in' })}
          </div>
          <div className="flex flex-wrap gap-1">
            {worksIn.length ? (
              worksIn.map((w) => (
                <span key={w} className="rounded bg-muted px-1.5 py-0.5">
                  {w}
                </span>
              ))
            ) : (
              <span className="opacity-50">—</span>
            )}
          </div>
        </div>
        <div>
          <div className="opacity-70 mb-1">
            {t('extensions.card.permissions', {
              defaultValue: 'Permissions',
              count: permissions.length,
            })}{' '}
            ({permissions.length})
          </div>
          <PermissionsList permissions={permissions} />
        </div>
      </div>
    </div>
  )
}

function RuntimeBadge({ runtime }: { runtime: ExtensionRuntime }) {
  const { t } = useTranslation()
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium opacity-90"
      title={t(`extensions.runtime.${runtime}.hint`, {
        defaultValue: RUNTIME_PLACEMENT[runtime],
      })}
    >
      <span className="opacity-70">{t('extensions.card.runtime', { defaultValue: 'Runtime' })}:</span>
      {t(`extensions.runtime.${runtime}`, { defaultValue: runtime })}
    </span>
  )
}

function PermissionsList({ permissions }: { permissions: ExtensionPermission[] }) {
  const { t } = useTranslation()
  if (!permissions.length) {
    return (
      <span className="text-xs opacity-60">
        {t('extensions.card.noPermissions', { defaultValue: 'No permissions' })}
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {permissions.map((permission) => (
        <span
          key={permission}
          className={`rounded px-1.5 py-0.5 text-[10px] font-mono border ${
            permission.startsWith('secrets.use:') ||
              (HIGH_RISK_PERMISSIONS as readonly string[]).includes(permission)
              ? 'border-amber-500/60 text-amber-700 dark:text-amber-300 bg-amber-500/10'
              : 'opacity-80'
          }`}
        >
          {permission}
        </span>
      ))}
    </div>
  )
}

export default function ExtensionsSettingsPage() {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id
  const [section, setSection] = useState<SectionId>('installed')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<ExtensionsListInstalledResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await window.electronAPI.extensionsListInstalled({
        workspaceId: workspaceId ?? undefined,
      })
      setInstalled(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
    const offExtensionsChanged = window.electronAPI.onExtensionsChanged(() => {
      void load()
    })
    // Marketplace owns installs, updates, and removals. Its changes can alter
    // this installed projection, so refresh without taking ownership of actions.
    const offMarketplaceChanged = window.electronAPI.onMarketplaceChanged(() => {
      void load()
    })
    return () => {
      offExtensionsChanged()
      offMarketplaceChanged()
    }
  }, [load])

  const runBusy = useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusy((current) => ({ ...current, [id]: true }))
      try {
        await fn()
        setActionMsg(t('extensions.action.success', { defaultValue: 'Done' }))
        window.setTimeout(() => setActionMsg(null), 2500)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    },
    [load, t],
  )

  const installedRecords = installed?.records ?? []
  const filteredInstalled = useMemo(() => {
    let records = installedRecords
    if (category !== 'all') records = records.filter((record) => record.category === category)
    if (query.trim()) {
      const normalizedQuery = query.trim().toLowerCase()
      records = records.filter((record) =>
        [record.manifest.name, record.description ?? '', record.id, ...(record.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
    }
    return records
  }, [installedRecords, category, query])

  const updates = useMemo(
    () => installedRecords.filter((record) => record.status === 'update-available'),
    [installedRecords],
  )
  const disabled = useMemo(
    () => installedRecords.filter((record) => record.status === 'disabled'),
    [installedRecords],
  )
  const permissionRows = useMemo(
    () =>
      installedRecords.map((record) => ({
        id: record.id,
        name: record.manifest.name,
        permissions: record.manifest.permissions,
        status: record.status,
      })),
    [installedRecords],
  )

  const renderRecordCard = (record: ExtensionRecord) => (
    <ExtensionCard
      key={record.id}
      name={record.manifest.name}
      version={record.manifest.version}
      description={record.description}
      runtime={record.manifest.runtime}
      category={record.category}
      permissions={record.manifest.permissions}
      worksIn={record.worksIn}
      installTarget={record.installTarget}
      status={record.status}
      readOnly={record.readOnly}
      busy={Boolean(busy[record.id])}
      onToggle={(enabled) =>
        void runBusy(record.id, async () => {
          await window.electronAPI.extensionsSetEnabled({ id: record.id, enabled })
        })
      }
    />
  )

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title={t('settings.extensions.title', { defaultValue: 'Extensions' })}
        actions={<HeaderMenu route={routes.view.settings('extensions')} />}
      />

      <ScrollArea className="flex-1">
        <div className="px-5 pt-6 pb-10 max-w-3xl mx-auto w-full space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {SECTIONS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={`text-xs rounded-md border px-2.5 py-1 ${
                  section === id ? 'bg-muted font-medium' : 'opacity-70 hover:opacity-100'
                }`}
              >
                {t(`extensions.section.${id}`, { defaultValue: id })}
              </button>
            ))}
          </div>

          {section === 'installed' ? (
            <div className="flex flex-wrap gap-1.5 items-center">
              <button
                type="button"
                onClick={() => setCategory('all')}
                className={`text-xs rounded-full border px-2.5 py-1 ${
                  category === 'all' ? 'bg-muted font-medium' : 'opacity-70'
                }`}
              >
                {t('extensions.category.all', { defaultValue: 'All' })}
              </button>
              {CATALOG_CATEGORIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  className={`text-xs rounded-full border px-2.5 py-1 ${
                    category === item ? 'bg-muted font-medium' : 'opacity-70'
                  }`}
                >
                  {t(`extensions.category.${item}`, { defaultValue: item })}
                </button>
              ))}
              <input
                className="ml-auto border rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background min-w-[12rem]"
                placeholder={t('extensions.search', { defaultValue: 'Search extensions…' })}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                onClick={() => void load()}
                className="inline-flex items-center gap-1 text-xs border rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <RefreshCw className="w-3 h-3" />
                {t('extensions.refresh', { defaultValue: 'Refresh' })}
              </button>
            </div>
          ) : null}

          {actionMsg ? (
            <div className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              {actionMsg}
            </div>
          ) : null}
          {error ? (
            <div className="text-xs text-destructive border border-destructive/30 rounded-md px-3 py-2">
              {error}
            </div>
          ) : null}
          {loading ? (
            <div className="flex items-center gap-2 text-sm opacity-70 py-10 justify-center">
              <Spinner className="w-4 h-4" />
              {t('extensions.loading', { defaultValue: 'Loading extensions…' })}
            </div>
          ) : null}

          {!loading && section === 'installed' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2">
                <Blocks className="w-3.5 h-3.5" />
                {t('extensions.installed.count', {
                  defaultValue: '{{count}} installed',
                  count: filteredInstalled.length,
                })}
              </div>
              {filteredInstalled.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.installed.empty', {
                    defaultValue: 'No installed extensions in this workspace yet.',
                  })}
                </p>
              ) : (
                filteredInstalled.map(renderRecordCard)
              )}
            </div>
          ) : null}

          {!loading && section === 'updates' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs opacity-60 flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t('extensions.updates.count', {
                    defaultValue: '{{count}} updates available',
                    count: updates.length,
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => navigate(routes.view.settings('marketplace'))}
                  className="text-xs border rounded-md px-2.5 py-1 hover:bg-muted shrink-0"
                >
                  {t('extensions.updates.openMarketplace', { defaultValue: 'Open Marketplace' })}
                </button>
              </div>
              {updates.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.updates.empty', { defaultValue: 'No updates available.' })}
                </p>
              ) : (
                updates.map(renderRecordCard)
              )}
            </div>
          ) : null}

          {!loading && section === 'permissions' ? (
            <div className="space-y-3">
              <div className="text-xs opacity-60 flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                {t('extensions.permissions.summary', {
                  defaultValue: 'Granted permissions by extension',
                })}
              </div>
              {permissionRows.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.permissions.empty', { defaultValue: 'No extensions installed.' })}
                </p>
              ) : (
                permissionRows.map((row) => (
                  <div key={row.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{row.name}</span>
                      <span className="text-[10px] uppercase opacity-60">
                        {t(`extensions.status.${row.status}`, { defaultValue: row.status })}
                      </span>
                    </div>
                    <PermissionsList permissions={row.permissions} />
                  </div>
                ))
              )}
            </div>
          ) : null}

          {!loading && section === 'disabled' ? (
            <div className="space-y-3">
              {disabled.length === 0 ? (
                <p className="text-sm opacity-60">
                  {t('extensions.disabled.empty', { defaultValue: 'No disabled extensions.' })}
                </p>
              ) : (
                disabled.map(renderRecordCard)
              )}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
