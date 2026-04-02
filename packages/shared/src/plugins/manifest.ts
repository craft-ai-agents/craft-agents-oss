import { z } from 'zod'
import type {
  CraftPluginManifest,
  PluginCapabilityType,
  PluginContributionRefs,
  PluginPermission,
} from './types'

export const PLUGIN_PERMISSIONS = [
  'network',
  'filesystem',
  'session.read',
  'session.write',
  'routing.control',
  'sources.read',
  'sources.write',
  'tools.invoke',
  'voice.input',
  'voice.output',
  'ui.render',
  'automation.manage',
] as const satisfies readonly PluginPermission[]

export const PLUGIN_CAPABILITY_TYPES = [
  'backend',
  'routingPolicy',
  'sourceConnector',
  'settingsPane',
  'routePage',
  'sessionAction',
  'composerAction',
  'chatCardType',
  'eventEnricher',
  'taskProvider',
  'automationProvider',
  'voiceInputProvider',
  'speechOutputProvider',
  'mcpAppProvider',
] as const satisfies readonly PluginCapabilityType[]

export const CONTRIBUTION_KEYS = [
  'backends',
  'routingPolicies',
  'sourceConnectors',
  'settingsPanes',
  'routes',
  'sessionActions',
  'composerActions',
  'chatCardTypes',
  'eventEnrichers',
  'taskProviders',
  'automationProviders',
  'voiceInputProviders',
  'speechOutputProviders',
  'mcpAppProviders',
] as const satisfies readonly (keyof PluginContributionRefs)[]

const semverLike = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/
const contributionRefSchema = z.array(z.string().min(1)).optional()

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(semverLike, 'version must be semver-like'),
  apiVersion: z.string().regex(semverLike, 'apiVersion must be semver-like'),
  description: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  homepage: z.string().url().optional(),
  engines: z.object({
    craftAgents: z.string().min(1),
  }),
  trust: z.object({
    signed: z.boolean().optional(),
    publisher: z.string().min(1).optional(),
  }).optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).default([]),
  entrypoints: z.object({
    main: z.string().min(1).optional(),
    helper: z.string().min(1).optional(),
    ui: z.string().min(1).optional(),
  }).optional(),
  contributions: z.object({
    backends: contributionRefSchema,
    routingPolicies: contributionRefSchema,
    sourceConnectors: contributionRefSchema,
    settingsPanes: contributionRefSchema,
    routes: contributionRefSchema,
    sessionActions: contributionRefSchema,
    composerActions: contributionRefSchema,
    chatCardTypes: contributionRefSchema,
    eventEnrichers: contributionRefSchema,
    taskProviders: contributionRefSchema,
    automationProviders: contributionRefSchema,
    voiceInputProviders: contributionRefSchema,
    speechOutputProviders: contributionRefSchema,
    mcpAppProviders: contributionRefSchema,
  }).default({}),
}) satisfies z.ZodType<CraftPluginManifest>

export function parsePluginManifest(input: unknown): CraftPluginManifest {
  return pluginManifestSchema.parse(input)
}

export function isPluginPermission(value: string): value is PluginPermission {
  return (PLUGIN_PERMISSIONS as readonly string[]).includes(value)
}

export function isPluginCapabilityType(value: string): value is PluginCapabilityType {
  return (PLUGIN_CAPABILITY_TYPES as readonly string[]).includes(value)
}

export function listManifestContributionIds(manifest: CraftPluginManifest): string[] {
  return CONTRIBUTION_KEYS.flatMap((key) => manifest.contributions[key] ?? [])
}

export function listManifestCapabilityTypes(manifest: CraftPluginManifest): PluginCapabilityType[] {
  const mappings: Array<[keyof PluginContributionRefs, PluginCapabilityType]> = [
    ['backends', 'backend'],
    ['routingPolicies', 'routingPolicy'],
    ['sourceConnectors', 'sourceConnector'],
    ['settingsPanes', 'settingsPane'],
    ['routes', 'routePage'],
    ['sessionActions', 'sessionAction'],
    ['composerActions', 'composerAction'],
    ['chatCardTypes', 'chatCardType'],
    ['eventEnrichers', 'eventEnricher'],
    ['taskProviders', 'taskProvider'],
    ['automationProviders', 'automationProvider'],
    ['voiceInputProviders', 'voiceInputProvider'],
    ['speechOutputProviders', 'speechOutputProvider'],
    ['mcpAppProviders', 'mcpAppProvider'],
  ]

  return mappings.flatMap(([key, type]) => (manifest.contributions[key]?.length ? [type] : []))
}
