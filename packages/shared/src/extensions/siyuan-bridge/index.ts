/**
 * SiYuan plugin bridge domain (W6).
 *
 * Pure projection + catalog provider. Plugins execute inside SiYuan runtime
 * only — never in Electron main / Craft Extension Host.
 */

export * from './types.ts'
export {
  parseSiYuanPluginManifest,
  detectCompatLevel,
  localizedText,
} from './manifest.ts'
export {
  projectBridgeContributions,
  defaultBridgeGrantedPermissions,
  type ProjectBridgeOptions,
} from './project.ts'
export { pluginJsonToExtensionRecord, pluginJsonToCatalogEntry, type PluginJsonToCatalogEntryOptions } from './record.ts'
export {
  SiyuanBazaarProvider,
  createSiyuanBazaarProvider,
  type SiyuanBazaarListFn,
} from './bazaar.ts'
