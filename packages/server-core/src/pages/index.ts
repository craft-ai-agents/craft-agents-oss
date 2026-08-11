/**
 * Craft Pages — local serving of agent-authored web pages.
 * Trust model and the measurements behind it: docs/adr/0001-craft-pages-trust-model.md
 */
export { PageCatalogService, sessionPagesRoot, pagePublicDir } from './catalog.ts'
export { PagesRuntime } from './runtime.ts'
export { createPagesHandler, type PagesHandlerOptions } from './handler.ts'
export { startPagesServer, type PagesServerOptions, type RunningPagesServer } from './server.ts'
export { resolveWithinPublicRoot, isReadMethod, type ContainmentResult } from './containment.ts'
export { GrantStore, type Grant, type ApproveInput } from './grants/store.ts'
export { isTrustedReadOnlyTool, trustedToolsForSource, sourcesWithTrustedTools } from './grants/allowlist.ts'
export { validateParamSchema, validateParams, type ParamSchema } from './grants/param-schema.ts'
export { createBridgeHandler } from './grants/bridge.ts'
export { WorkspaceSourcePool, type PoolLike } from './grants/source-pool.ts'
export { createWorkspacePoolBuilder, eligibleSourcesForPages } from './grants/pool-builder.ts'
export { countPagesInSession, purgeSessionPages } from './session-deletion.ts'
export { resolvePageCatalogForSession } from './session-binding.ts'
