import { z } from 'zod'
import type {
  CraftPluginManifest,
  PluginCapabilityType,
  PluginContributionRefs,
  PluginHookNamespace,
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

export const PLUGIN_HOOK_NAMESPACES = [
  'backend.registry',
  'routing.policy',
  'source.catalog',
  'settings.sections',
  'navigation.routes',
  'session.actions',
  'composer.actions',
  'chat.cards',
  'event.pipeline',
  'task.providers',
  'automation.providers',
  'voice.input',
  'speech.output',
  'mcp.app.surface',
] as const satisfies readonly PluginHookNamespace[]

const semverLike = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/
const contributionRefSchema = z.array(z.string().min(1)).optional()
const capabilityMetadataSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  hook: z.enum(PLUGIN_HOOK_NAMESPACES).optional(),
  placement: z.enum(['menu', 'toolbar']).optional(),
  invoke: z.discriminatedUnion('type', [
    z.object({ type: z.literal('noop') }),
    z.object({
      type: z.literal('navigate'),
      route: z.string().min(1),
      newPanel: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('toast'),
      level: z.enum(['info', 'success', 'warning', 'error']).optional(),
      message: z.string().min(1),
      description: z.string().min(1).optional(),
    }),
    z.object({
      type: z.literal('insertText'),
      text: z.string(),
      mode: z.enum(['replace', 'append', 'prepend']).optional(),
    }),
  ]).optional(),
  matcher: z.object({
    role: z.enum(['assistant', 'tool', 'plan']).optional(),
    toolName: z.string().min(1).optional(),
    toolStatus: z.enum(['pending', 'executing', 'completed', 'error', 'backgrounded']).optional(),
    isError: z.boolean().optional(),
  }).optional(),
  tone: z.enum(['neutral', 'info', 'success', 'warning', 'error']).optional(),
}).strict()
const contributionMetadataMapSchema = z.record(z.string().min(1), capabilityMetadataSchema).optional()

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
  capabilityMetadata: z.object({
    backends: contributionMetadataMapSchema,
    routingPolicies: contributionMetadataMapSchema,
    sourceConnectors: contributionMetadataMapSchema,
    settingsPanes: contributionMetadataMapSchema,
    routes: contributionMetadataMapSchema,
    sessionActions: contributionMetadataMapSchema,
    composerActions: contributionMetadataMapSchema,
    chatCardTypes: contributionMetadataMapSchema,
    eventEnrichers: contributionMetadataMapSchema,
    taskProviders: contributionMetadataMapSchema,
    automationProviders: contributionMetadataMapSchema,
    voiceInputProviders: contributionMetadataMapSchema,
    speechOutputProviders: contributionMetadataMapSchema,
    mcpAppProviders: contributionMetadataMapSchema,
  }).optional(),
}) satisfies z.ZodType<CraftPluginManifest>

export function parsePluginManifest(input: unknown): CraftPluginManifest {
  return pluginManifestSchema.parse(input)
}

function parseSemverLike(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemverLike(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index]! < right[index]! ? -1 : 1
    }
  }
  return 0
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

export function isPluginApiVersionSupported(
  pluginApiVersion: string,
  supportedApiVersion: string,
): boolean {
  const plugin = parseSemverLike(pluginApiVersion)
  const supported = parseSemverLike(supportedApiVersion)
  if (!plugin || !supported) return false
  if (plugin[0] !== supported[0]) return false
  return compareSemverLike(plugin, supported) <= 0
}

export function isPluginEngineSatisfied(
  manifest: CraftPluginManifest,
  hostVersion: string,
): boolean {
  const requirement = manifest.engines.craftAgents.trim()
  if (!requirement) return false
  if (requirement === '*') return true

  const actual = parseSemverLike(hostVersion)
  if (!actual) return false

  if (requirement.startsWith('^')) {
    const minimum = parseSemverLike(requirement.slice(1))
    if (!minimum) return false
    if (compareSemverLike(actual, minimum) < 0) return false

    if (minimum[0] > 0) {
      return actual[0] === minimum[0]
    }
    if (minimum[1] > 0) {
      return actual[0] === 0 && actual[1] === minimum[1]
    }
    return actual[0] === 0 && actual[1] === 0 && actual[2] === minimum[2]
  }

  const exact = parseSemverLike(requirement)
  return exact ? compareSemverLike(actual, exact) === 0 : false
}
