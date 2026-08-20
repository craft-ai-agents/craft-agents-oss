/**
 * Browser-safe extension catalog contracts and permission vocabulary.
 * Persistent extension state and provider adapters are node-only.
 */
export * from './types.ts'
export type { ExtensionHostStatus } from './siyuan-bridge/types.ts'
export {
  EXTENSION_PERMISSIONS,
  HIGH_RISK_PERMISSIONS,
  extensionPermissionRisk,
  isExtensionPermission,
  permissionsFromAlwaysAllow,
  type ExtensionPermissionRisk,
} from './permissions.ts'
