/**
 * Craft Pages — local serving of agent-authored web pages.
 * Trust model and the measurements behind it: docs/adr/0001-craft-pages-trust-model.md
 */
export { PageCatalogService, sessionPagesRoot, pagePublicDir } from './catalog.ts'
export { PagesRuntime } from './runtime.ts'
export { createPagesHandler, type PagesHandlerOptions } from './handler.ts'
export { startPagesServer, type PagesServerOptions, type RunningPagesServer } from './server.ts'
export { resolveWithinPublicRoot, isReadMethod, type ContainmentResult } from './containment.ts'
