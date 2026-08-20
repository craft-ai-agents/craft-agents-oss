/**
 * @craft-agent/cloud-runner — Cloud Runs contract + local provider.
 *
 * See docs/cloud-runs-prd.md. Providers: LocalSubprocessProvider
 * (reference + dev mode); CloudflareComputerProvider (PRD phase G2).
 */
export {
  CloudRunnerError,
  DEFAULT_RUN_LIMITS,
  assertSafeArtifactPath,
  resolveLimits,
} from './types.ts';
export type {
  ArtifactMeta,
  CloudRunProvider,
  CloudRunSubtask,
  RunEvent,
  RunFailureReason,
  RunHandle,
  RunLimits,
  RunSpec,
  RunState,
  RunStatus,
} from './types.ts';
export { LocalSubprocessProvider } from './local-provider.ts';
export type { LocalProviderOptions } from './local-provider.ts';
export { CloudflareComputerProvider } from './cloudflare-provider.ts';
export type { CloudflareProviderOptions } from './cloudflare-provider.ts';
export { ModalProvider } from './modal-provider.ts';
export { buildResearchSpec, DEFAULT_PERSONAS } from './research-pack.ts';
export type { ResearchPackOptions, ResearchPackKind } from './research-pack.ts';
export { conformanceSuite } from './conformance.ts';
