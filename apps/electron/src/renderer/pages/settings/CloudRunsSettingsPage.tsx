/**
 * CloudRunsSettingsPage — enable/configure cloud runs
 * (PRD docs/cloud-runs-prd.md, G3.4 + P2.8 UX rewrite).
 *
 * Reads/writes config.json via cloudRuns RPC. The provider token is NOT
 * editable here: it lives in <configDir>/cloud-runs.env (0600,
 * user-managed); the page only shows whether it's present.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'cloudRuns',
}

type Provider = 'local' | 'cloudflare' | 'modal' | 'e2b'
interface Config {
  enabled: boolean
  provider: Provider
  gatewayUrl?: string
  notifyWebhookUrl?: string
  cheapModelId?: string
  personas?: boolean
  tokenConfigured: boolean
  defaults: { maxWallClockSec: number; maxLlmTokens: number; maxArtifactsBytes: number }
}

const fieldClass =
  'w-full max-w-xl rounded-md border border-border bg-background px-2.5 py-1.5 text-sm shadow-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type ConfigPatch = Partial<Config> & {
  defaultMaxWallClockSec?: number
  defaultMaxLlmTokens?: number
  defaultMaxArtifactsBytes?: number
}

function SettingText({ label, description }: { label: string; description: string }) {
  return (
    <div className="min-w-0 whitespace-normal break-words">
      <div>{label}</div>
      <div className="mt-1 text-xs font-normal text-muted-foreground">{description}</div>
    </div>
  )
}

export default function CloudRunsSettingsPage() {
  const { t } = useTranslation()
  const [config, setConfig] = React.useState<Config | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [failedPatch, setFailedPatch] = React.useState<ConfigPatch | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const getConfig = window.electronAPI?.getCloudRunsConfig
      if (typeof getConfig !== 'function') throw new Error(t('common.unavailable'))
      setConfig(await getConfig())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const patch = (nextPatch: ConfigPatch) => {
    setSaveError(null)
    setFailedPatch(null)
    window.electronAPI
      .setCloudRunsConfig(nextPatch)
      .then(() =>
        setConfig((previous) => {
          if (!previous) return previous
          const next = { ...previous, ...nextPatch }
          if (nextPatch.defaultMaxWallClockSec != null) {
            next.defaults = { ...previous.defaults, maxWallClockSec: nextPatch.defaultMaxWallClockSec }
          }
          if (nextPatch.defaultMaxLlmTokens != null) {
            next.defaults = { ...next.defaults, maxLlmTokens: nextPatch.defaultMaxLlmTokens }
          }
          if (nextPatch.defaultMaxArtifactsBytes != null) {
            next.defaults = { ...next.defaults, maxArtifactsBytes: nextPatch.defaultMaxArtifactsBytes }
          }
          return next
        }),
      )
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setSaveError(message)
        setFailedPatch(nextPatch)
        toast.error(t('cloudRuns.error'), { description: message })
      })
  }

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border/50 px-6 py-4">
        <div className="min-w-0">
          <h2 className="whitespace-normal break-words text-lg font-semibold">{t('settings.cloudRuns.title')}</h2>
          <p className="mt-1 whitespace-normal break-words text-sm text-muted-foreground">{t('settings.cloudRuns.description')}</p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          {loading ? t('common.loading') : t('common.retry')}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-5">
          {loadError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 whitespace-normal break-words">{loadError}</span>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('common.retry')}
              </Button>
            </div>
          )}
          {saveError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive">
              <span className="min-w-0 whitespace-normal break-words">{saveError}</span>
              {failedPatch && (
                <Button size="sm" variant="outline" onClick={() => patch(failedPatch)}>
                  {t('common.retry')}
                </Button>
              )}
            </div>
          )}

          {!config && !loadError && (
            <div role="status" className="rounded-md border border-border/60 px-3 py-2 text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          )}

          {config && (
            <>
              <SettingsSection title={t('settings.cloudRuns.sectionConnection')}>
                <SettingsCard className="gap-1">
                  <SettingsToggle
                    label={<SettingText label={t('settings.cloudRuns.enable')} description={t('settings.cloudRuns.enableHint')} />}
                    checked={config.enabled}
                    onCheckedChange={(checked) => patch({ enabled: checked })}
                  />
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.provider')} description={t('settings.cloudRuns.providerHint')} />}>
                    <select
                      aria-label={t('settings.cloudRuns.provider')}
                      className={fieldClass + ' w-56'}
                      value={config.provider}
                      onChange={(e) => patch({ provider: e.target.value as Provider })}
                    >
                      <option value="local">{t('settings.cloudRuns.providerLocal')}</option>
                      <option value="cloudflare">Cloudflare</option>
                      <option value="modal">Modal</option>
                    </select>
                  </SettingsRow>
                  {(config.provider === 'cloudflare' || config.provider === 'modal') && (
                    <>
                      <SettingsRow label={<SettingText label={t('settings.cloudRuns.gatewayUrl')} description={t('settings.cloudRuns.gatewayUrlHint')} />}>
                        <Input
                          className={fieldClass}
                          defaultValue={config.gatewayUrl ?? ''}
                          placeholder="https://craft-cloud-gateway.<sub>.workers.dev"
                          onBlur={(e) => patch({ gatewayUrl: e.target.value.trim() || undefined })}
                        />
                      </SettingsRow>
                      <SettingsRow
                        label={
                          <SettingText
                            label={t('settings.cloudRuns.token')}
                            description={config.tokenConfigured ? t('settings.cloudRuns.tokenSet') : t('settings.cloudRuns.tokenMissing')}
                          />
                        }
                      >
                        <span
                          className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-md border px-2 text-xs font-medium ${
                            config.tokenConfigured
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-destructive/40 bg-destructive/10 text-destructive'
                          }`}
                        >
                          {config.tokenConfigured ? '✓' : '✗'}
                        </span>
                      </SettingsRow>
                    </>
                  )}
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.webhook')} description={t('settings.cloudRuns.webhookHint')} />}>
                    <Input
                      className={fieldClass}
                      defaultValue={config.notifyWebhookUrl ?? ''}
                      placeholder="https://example.com/cloud-runs-hook"
                      onBlur={(e) => patch({ notifyWebhookUrl: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.cloudRuns.sectionLimits')}>
                <SettingsCard>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxWallClock')} description={t('settings.cloudRuns.maxWallClockHint')} />}>
                    <Input
                      className={fieldClass + ' w-32'}
                      type="number"
                      min={60}
                      defaultValue={config.defaults.maxWallClockSec}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 60) patch({ defaultMaxWallClockSec: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxLlmTokens')} description={t('settings.cloudRuns.maxLlmTokensHint')} />}>
                    <Input
                      className={fieldClass + ' w-40'}
                      type="number"
                      min={10_000}
                      defaultValue={config.defaults.maxLlmTokens}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 10_000) patch({ defaultMaxLlmTokens: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.maxArtifacts')} description={t('settings.cloudRuns.maxArtifactsHint')} />}>
                    <Input
                      className={fieldClass + ' w-40'}
                      type="number"
                      min={1_000_000}
                      defaultValue={config.defaults.maxArtifactsBytes}
                      onBlur={(e) => {
                        const value = Number(e.target.value)
                        if (Number.isInteger(value) && value >= 1_000_000) patch({ defaultMaxArtifactsBytes: value })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label={<SettingText label={t('settings.cloudRuns.cheapModel')} description={t('settings.cloudRuns.cheapModelHint')} />}>
                    <Input
                      className={fieldClass + ' w-64'}
                      defaultValue={config.cheapModelId ?? ''}
                      placeholder="kimi-lite / gpt-4o-mini"
                      onBlur={(e) => patch({ cheapModelId: e.target.value.trim() || undefined })}
                    />
                  </SettingsRow>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.cloudRuns.sectionSchedule')}>
                <SettingsCard>
                  <div className="space-y-2 px-4 py-3 text-sm text-muted-foreground">
                    <p className="min-w-0 whitespace-normal break-words">{t('settings.cloudRuns.scheduleHelp')}</p>
                    <p className="min-w-0 whitespace-normal break-words text-xs opacity-80">{t('settings.cloudRuns.everyHoursHelp')}</p>
                  </div>
                </SettingsCard>
              </SettingsSection>

              <SettingsSection title={t('settings.cloudRuns.sectionPersonas')}>
                <SettingsCard>
                  <SettingsToggle
                    label={<SettingText label={t('settings.cloudRuns.personasLbl')} description={t('settings.cloudRuns.personasHint')} />}
                    checked={config.personas ?? false}
                    onCheckedChange={(checked) => patch({ personas: checked })}
                  />
                </SettingsCard>
              </SettingsSection>
            </>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border/50 px-6 py-3 text-xs text-muted-foreground">
        <span role="status">{config?.enabled ? t('automations.statusActive') : t('automations.statusDisabled')}</span>
      </footer>
    </div>
  )
}
