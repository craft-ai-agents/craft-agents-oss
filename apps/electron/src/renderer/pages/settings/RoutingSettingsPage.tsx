import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@craft-agent/ui'
import type { PluginCapabilityRef, PluginSummary } from '@craft-agent/shared/plugins'
import { FEATURE_FLAGS } from '@craft-agent/shared/feature-flags'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { routes } from '@/lib/navigate'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  SettingsCard,
  SettingsCardContent,
  SettingsRow,
  SettingsSection,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'routing',
}

function EmptySurfaceCard({ title, description }: { title: string; description: string }) {
  return (
    <SettingsCard divided={false}>
      <SettingsCardContent>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      </SettingsCardContent>
    </SettingsCard>
  )
}

function SurfaceCard({
  title,
  description,
  capabilities,
  pluginNames,
}: {
  title: string
  description: string
  capabilities: PluginCapabilityRef[]
  pluginNames: Map<string, string>
}) {
  if (capabilities.length === 0) {
    return <EmptySurfaceCard title={title} description={description} />
  }

  return (
    <SettingsCard divided={false}>
      <SettingsCardContent className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="space-y-3">
          {capabilities.map((capability) => (
            <div key={`${capability.pluginId}:${capability.id}`} className="rounded-lg border border-border/60 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{capability.id}</span>
                <Badge variant="secondary">{pluginNames.get(capability.pluginId) ?? capability.pluginId}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {capability.type} hook from <code>{capability.pluginId}</code>
              </p>
            </div>
          ))}
        </div>
      </SettingsCardContent>
    </SettingsCard>
  )
}

export default function RoutingSettingsPage() {
  const [plugins, setPlugins] = useState<PluginSummary[]>([])
  const [routesList, setRoutesList] = useState<PluginCapabilityRef[]>([])
  const [settingsPanes, setSettingsPanes] = useState<PluginCapabilityRef[]>([])
  const [sessionActions, setSessionActions] = useState<PluginCapabilityRef[]>([])
  const [composerActions, setComposerActions] = useState<PluginCapabilityRef[]>([])
  const [chatCardTypes, setChatCardTypes] = useState<PluginCapabilityRef[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  const loadData = useCallback(async () => {
    try {
      const [
        pluginList,
        pluginRoutes,
        pluginSettingsPanes,
        pluginSessionActions,
        pluginComposerActions,
        pluginChatCardTypes,
      ] = await Promise.all([
        window.electronAPI.listPlugins(),
        window.electronAPI.listPluginRoutes(),
        window.electronAPI.listPluginSettingsPanes(),
        window.electronAPI.listPluginSessionActions(),
        window.electronAPI.listPluginComposerActions(),
        window.electronAPI.listPluginChatCardTypes(),
      ])

      setPlugins(pluginList)
      setRoutesList(pluginRoutes)
      setSettingsPanes(pluginSettingsPanes)
      setSessionActions(pluginSessionActions)
      setComposerActions(pluginComposerActions)
      setChatCardTypes(pluginChatCardTypes)
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const pluginNames = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin.name])), [plugins])
  const enabledPluginCount = useMemo(() => plugins.filter((plugin) => plugin.enabled).length, [plugins])
  const contributingPluginCount = useMemo(() => {
    return new Set(
      [...routesList, ...settingsPanes, ...sessionActions, ...composerActions, ...chatCardTypes]
        .map((capability) => capability.pluginId),
    ).size
  }, [routesList, settingsPanes, sessionActions, composerActions, chatCardTypes])

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
        title="Routing"
        actions={<HeaderMenu route={routes.view.settings('routing')} />}
      />
      <ScrollArea className="flex-1">
        <div className="px-5 py-7 max-w-3xl mx-auto space-y-8">
          <SettingsSection title="Extension Surface" description="Host-owned navigation and interaction points exposed to plugins.">
            <SettingsCard>
              <SettingsRow
                label="Routing UI"
                description="Settings and registry surfaces for plugin-driven navigation."
              >
                <Badge variant={FEATURE_FLAGS.pluginRoutingUi ? 'default' : 'outline'}>
                  {FEATURE_FLAGS.pluginRoutingUi ? 'Enabled' : 'Disabled'}
                </Badge>
              </SettingsRow>
              <SettingsRow
                label="Enabled plugins"
                description={`${enabledPluginCount} plugins are currently enabled in the host registry.`}
              />
              <SettingsRow
                label="Contributing plugins"
                description={`${contributingPluginCount} plugins currently contribute ${routesList.length + settingsPanes.length + sessionActions.length + composerActions.length + chatCardTypes.length} routed capabilities.`}
              />
              <SettingsRow
                label="Host projection model"
                description="Renderer pages are host-rendered from structured plugin data. No arbitrary plugin React is mounted directly into chat or settings."
              />
            </SettingsCard>
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </SettingsSection>

          <SettingsSection title="Pages and Settings" description="Plugin-contributed routes that the host shell can project safely.">
            <div className="space-y-4">
              <SurfaceCard
                title="Route Pages"
                description="Dedicated pages contributed through the plugin route registry."
                capabilities={routesList}
                pluginNames={pluginNames}
              />
              <SurfaceCard
                title="Settings Panes"
                description="Additional settings surfaces registered by plugins."
                capabilities={settingsPanes}
                pluginNames={pluginNames}
              />
            </div>
          </SettingsSection>

          <SettingsSection title="Chat Surfaces" description="Structured hooks that extend the session UI without direct component patching.">
            <div className="space-y-4">
              <SurfaceCard
                title="Session Actions"
                description="Session-level actions surfaced by the host shell."
                capabilities={sessionActions}
                pluginNames={pluginNames}
              />
              <SurfaceCard
                title="Composer Actions"
                description="Input box actions such as send-target selectors or voice controls."
                capabilities={composerActions}
                pluginNames={pluginNames}
              />
              <SurfaceCard
                title="Chat Card Types"
                description="Structured card renderers that the host can safely project into chat."
                capabilities={chatCardTypes}
                pluginNames={pluginNames}
              />
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  )
}
