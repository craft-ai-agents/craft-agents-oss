import type { CraftPluginManifest } from './types'

export function createBuiltInUiPluginManifest(args: {
  appVersion: string
  pluginApiVersion: string
}): CraftPluginManifest {
  return {
    id: 'craft.plugins.ui',
    name: 'Plugin Host UI',
    version: args.appVersion,
    apiVersion: args.pluginApiVersion,
    description: 'Built-in plugin actions that expose host-owned plugin surfaces.',
    engines: { craftAgents: '*' },
    permissions: ['ui.render'],
    contributions: {
      sessionActions: ['open-plugin-settings', 'open-routing-settings'],
      composerActions: ['insert-plugin-checklist'],
    },
    capabilityMetadata: {
      sessionActions: {
        'open-plugin-settings': {
          title: 'Plugin Settings',
          description: 'Open the host-managed plugin settings page.',
          hook: 'session.actions',
          placement: 'menu',
          invoke: {
            type: 'navigate',
            route: 'settings/plugins',
          },
        },
        'open-routing-settings': {
          title: 'Routing Settings',
          description: 'Open the plugin routing and hook registry page.',
          hook: 'session.actions',
          placement: 'menu',
          invoke: {
            type: 'navigate',
            route: 'settings/routing',
          },
        },
      },
      composerActions: {
        'insert-plugin-checklist': {
          title: 'Insert Plugin Checklist',
          description: 'Insert a short checklist for reviewing plugin registry state.',
          hook: 'composer.actions',
          placement: 'toolbar',
          invoke: {
            type: 'insertText',
            mode: 'append',
            text: 'Review the active plugin capabilities, routing hooks, and next plugin-platform tasks.',
          },
        },
      },
    },
  }
}
