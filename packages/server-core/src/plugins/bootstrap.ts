import type { CraftPluginManifest } from '@craft-agent/shared/plugins'
import { PLUGIN_API_VERSION, PluginHost } from './host'

export interface BootstrapPluginHostOptions {
  appVersion: string
  builtInManifests?: CraftPluginManifest[]
  pluginApiVersion?: string
  pluginDirectory?: string
  helperRuntimePath?: string
  pluginStatePath?: string
  logger?: Pick<Console, 'warn'>
}

export async function bootstrapPluginHost(options: BootstrapPluginHostOptions): Promise<PluginHost> {
  const pluginHost = new PluginHost({
    appVersion: options.appVersion,
    pluginApiVersion: options.pluginApiVersion ?? PLUGIN_API_VERSION,
    pluginDirectory: options.pluginDirectory,
    helperRuntimePath: options.helperRuntimePath,
    pluginStatePath: options.pluginStatePath,
  })

  await pluginHost.initialize()

  for (const manifest of options.builtInManifests ?? []) {
    pluginHost.registerBuiltInPlugin(manifest)
  }

  await pluginHost.loadExternalPlugins()

  for (const failure of pluginHost.listLoadFailures()) {
    options.logger?.warn(`Failed to load plugin manifest at ${failure.pluginPath}: ${failure.error}`)
  }

  return pluginHost
}
