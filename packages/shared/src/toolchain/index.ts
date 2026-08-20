/**
 * Публичный API модуля toolchain.
 * Consumers: OmpAgent, agents env, bootstrap, UI status.
 */

export * from './types';
export { currentPlatform, toolchainPaths, loadManifest, TOOLCHAIN_MANIFEST } from './manifest';
export type { ManifestToolData } from './manifest-data';
export { createResolver } from './resolver';
export type { ResolverOptions } from './resolver';
export { OPENCLAW_CAPABILITIES, probeOpenClawCapabilities } from './openclaw';
export type {
  OpenClawCapability,
  OpenClawCapabilityProbeOptions,
  OpenClawCapabilityProbeRequest,
  OpenClawCapabilityProbeResult,
  OpenClawCapabilityProbeRunner,
} from './openclaw';
export { createManager } from './manager';
export type { ManagerOptions, PipInstallContext } from './manager';
export { downloadArtifact, ShaMismatchError, HttpError, NetworkError } from './downloader';
export type { DownloadOptions } from './downloader';
export { extractArtifact, installTool } from './installer';
export type { InstallResult } from './installer';
export { StatusEmitter } from './status';
export type { StatusListener } from './status';
