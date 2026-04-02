import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@craft-agent/ui'
import type { PluginCapabilityRef, PluginDetails } from '@craft-agent/shared/plugins'
import { FEATURE_FLAGS } from '@craft-agent/shared/feature-flags'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { routes } from '@/lib/navigate'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardFooter,
  SettingsRow,
  SettingsSection,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'plugins',
}

function statusVariant(status?: PluginDetails['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
  if (status === 'quarantined' || status === 'incompatible') return 'destructive'
  if (status === 'disabled') return 'outline'
  if (status === 'active') return 'default'
  return 'secondary'
}

function isBuiltInPlugin(plugin: PluginDetails): boolean {
  return plugin.source === 'built-in'
}

function summarizeCapabilities(plugin: PluginDetails, capabilities: PluginCapabilityRef[]): string {
  const ownCapabilities = capabilities.filter((capability) => capability.pluginId === plugin.id)
  if (ownCapabilities.length === 0) return 'No active capabilities registered yet.'
  return ownCapabilities.map((capability) => capability.id).join(', ')
}

export default function PluginsSettingsPage() {
  const [plugins, setPlugins] = useState<PluginDetails[]>([])
  const [capabilities, setCapabilities] = useState<PluginCapabilityRef[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [pendingPluginId, setPendingPluginId] = useState<string>()
  const [error, setError] = useState<string>()

  const loadData = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true)
    try {
      const [pluginSummaries, capabilityList] = await Promise.all([
        window.electronAPI.listPlugins(),
        window.electronAPI.listPluginCapabilities(),
      ])
      const pluginDetails = await Promise.all(
        pluginSummaries.map(async (plugin) => window.electronAPI.getPlugin(plugin.id)),
      )
      setPlugins(pluginDetails)
      setCapabilities(capabilityList)
      setError(undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setIsLoading(false)
      if (refresh) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const activePluginCount = useMemo(
    () => plugins.filter((plugin) => plugin.status === 'active').length,
    [plugins],
  )

  const handleTogglePlugin = useCallback(async (plugin: PluginDetails) => {
    setPendingPluginId(plugin.id)
    try {
      if (plugin.enabled) {
        await window.electronAPI.disablePlugin(plugin.id)
        toast.success(`${plugin.name} disabled`)
      } else {
        await window.electronAPI.enablePlugin(plugin.id)
        toast.success(`${plugin.name} enabled`)
      }
      await loadData(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(`Could not update ${plugin.name}: ${message}`)
    } finally {
      setPendingPluginId(undefined)
    }
  }, [loadData])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Plugins"
        actions={<HeaderMenu route={routes.view.settings('plugins')} />}
      />
      <ScrollArea className="flex-1">
        <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
          <SettingsSection title="Platform" description="Host-managed plugin state and capability projection.">
            <SettingsCard>
              <SettingsRow
                label="Plugin host"
                description="Main-process registry and plugin management surface."
              >
                <Badge variant={FEATURE_FLAGS.pluginHost ? 'default' : 'outline'}>
                  {FEATURE_FLAGS.pluginHost ? 'Enabled' : 'Disabled'}
                </Badge>
              </SettingsRow>
              <SettingsRow
                label="External plugins"
                description="Third-party manifests discovered from the local plugin directory."
              >
                <Badge variant={FEATURE_FLAGS.externalPlugins ? 'default' : 'outline'}>
                  {FEATURE_FLAGS.externalPlugins ? 'Enabled' : 'Disabled'}
                </Badge>
              </SettingsRow>
              <SettingsRow
                label="Loaded plugins"
                description={`${activePluginCount} active plugins with ${capabilities.length} active capabilities.`}
                action={(
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isRefreshing}
                    onClick={() => loadData(true)}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                )}
              />
            </SettingsCard>
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Installed Plugins" description="Each plugin is rendered by the host shell using structured metadata from the plugin registry.">
            <div className="space-y-4">
              {plugins.map((plugin) => {
                const busy = pendingPluginId === plugin.id
                const builtIn = isBuiltInPlugin(plugin)

                return (
                  <SettingsCard key={plugin.id} divided={false}>
                    <SettingsCardContent className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-foreground">{plugin.name}</h3>
                            <Badge variant="secondary">v{plugin.version}</Badge>
                            <Badge variant={statusVariant(plugin.status)}>
                              {plugin.status ?? 'unknown'}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {plugin.description ?? 'No description provided.'}
                          </p>
                        </div>
                        {builtIn && <Badge variant="outline">Built-in</Badge>}
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                            Plugin ID
                          </div>
                          <code className="text-xs text-foreground/80">{plugin.id}</code>
                        </div>
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                            Permissions
                          </div>
                          <p className="text-sm text-foreground/80">
                            {plugin.permissions.length > 0 ? plugin.permissions.join(', ') : 'No permissions declared'}
                          </p>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                            Active Capabilities
                          </div>
                          <p className="text-sm text-foreground/80">
                            {summarizeCapabilities(plugin, capabilities)}
                          </p>
                        </div>
                        {plugin.error && (
                          <div className="md:col-span-2 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                            <p className="text-sm text-destructive">{plugin.error}</p>
                          </div>
                        )}
                      </div>
                    </SettingsCardContent>
                    <SettingsCardFooter className="justify-between">
                      <span className="text-xs text-muted-foreground">
                        {plugin.compatible === false
                          ? 'This plugin is incompatible with the current app version.'
                          : builtIn
                            ? 'Built-in backend plugins stay enabled until runtime gating is fully registry-driven.'
                            : 'Use the host controls to enable or disable this plugin.'}
                      </span>
                      <Button
                        variant={plugin.enabled ? 'outline' : 'default'}
                        size="sm"
                        disabled={busy || builtIn || plugin.compatible === false}
                        onClick={() => handleTogglePlugin(plugin)}
                      >
                        {busy ? 'Saving...' : plugin.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </SettingsCardFooter>
                  </SettingsCard>
                )
              })}
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
