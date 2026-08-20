/**
 * SurfaceRegistry + surface model (S-02). The WorkspaceSurfaceHost
 * implementation is the renderer adapter over panel-stack.
 */

export type {
  KnowledgeRef,
  PanelLaneId,
  RenderNode,
  SurfaceContribution,
  SurfaceDescriptor,
  SurfaceLayoutSnapshot,
  SurfaceRegistry,
  SurfaceRenderContext,
  SurfaceTab,
  SurfaceTabKind,
} from './types.ts';
export { surfaceTabDurableKey, surfaceTabToDescriptor } from './descriptor.ts';
export { createSurfaceRegistry } from './registry.ts';
export type { WorkspaceSurfaceHost } from './host.ts';
