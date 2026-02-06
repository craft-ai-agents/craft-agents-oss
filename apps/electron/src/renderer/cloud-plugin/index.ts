/**
 * Cloud Plugin — Renderer
 *
 * Provides cloud-workspace UI features: cloud sync, sandbox status, and
 * the CloudPluginProvider context that replaces prop drilling of
 * isCloudWorkspace / isRemoteSandbox / sandboxStatuses.
 */

export { CloudPluginProvider, useCloudPlugin } from './CloudPluginContext'
export type { CloudPluginState } from './CloudPluginContext'
export { useCloudSync } from './useCloudSync'
export { useSandboxStatus } from './useSandboxStatus'
export type { UseSandboxStatusOptions, UseSandboxStatusResult } from './useSandboxStatus'
