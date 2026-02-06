/**
 * Cloud Workspace Types
 *
 * Shared types for the WebSocket protocol between the Craft Agent
 * Electron app and the Cloudflare Worker + Durable Object backend.
 *
 * These types are used by both:
 * - packages/shared/src/storage/cloud/ (client)
 * - packages/cloud-worker/ (server)
 */

// ============================================================
// Cloud Workspace Configuration
// ============================================================

export interface CloudWorkspaceConfig {
  /** Remote Worker URL, e.g., "https://my-craft-cloud.workers.dev" */
  remoteUrl: string;
  /** Workspace slug used as the Durable Object identity */
  workspaceSlug: string;
  /** Last time data was synced from the cloud */
  lastSyncedAt?: number;
}

// ============================================================
// WebSocket Client → Server Messages
// ============================================================

export type WSClientMessage =
  // Sessions
  | { type: 'session:create'; data: Record<string, unknown>; requestId: string }
  | { type: 'session:save'; data: { id: string; header: Record<string, unknown>; messages: unknown[] }; requestId: string }
  | { type: 'session:delete'; data: { sessionId: string }; requestId: string }
  | { type: 'session:updateMeta'; data: { sessionId: string; updates: Record<string, unknown> }; requestId: string }
  | { type: 'session:updateSdkId'; data: { sessionId: string; sdkSessionId: string }; requestId: string }
  | { type: 'session:clearMessages'; data: { sessionId: string }; requestId: string }
  // Sources
  | { type: 'source:create'; data: Record<string, unknown>; requestId: string }
  | { type: 'source:saveConfig'; data: Record<string, unknown>; requestId: string }
  | { type: 'source:delete'; data: { sourceSlug: string }; requestId: string }
  | { type: 'source:saveGuide'; data: { sourceSlug: string; guide: Record<string, unknown> }; requestId: string }
  // Statuses
  | { type: 'statuses:save'; data: Record<string, unknown>; requestId: string }
  // Labels
  | { type: 'labels:save'; data: Record<string, unknown>; requestId: string }
  // Skills
  | { type: 'skill:save'; data: { slug: string; content: string; metadata: Record<string, unknown> }; requestId: string }
  | { type: 'skill:delete'; data: { slug: string }; requestId: string }
  // Plans
  | { type: 'plan:save'; data: { sessionId: string; fileName: string; content: string }; requestId: string }
  | { type: 'plan:delete'; data: { sessionId: string; fileName: string }; requestId: string };

// ============================================================
// WebSocket Server → Client Messages
// ============================================================

export type WSServerMessage =
  | { type: 'response'; requestId: string; data: unknown; error?: string }
  | { type: 'broadcast'; event: WSRemoteChangeEvent };

// ============================================================
// Remote Change Events (broadcast to other clients)
// ============================================================

export type WSRemoteChangeEvent =
  | { entity: 'session'; action: 'created' | 'updated' | 'deleted'; data: Record<string, unknown> }
  | { entity: 'source'; action: 'created' | 'updated' | 'deleted'; data: Record<string, unknown> }
  | { entity: 'statuses'; action: 'updated'; data: Record<string, unknown> }
  | { entity: 'labels'; action: 'updated'; data: Record<string, unknown> }
  | { entity: 'skill'; action: 'created' | 'updated' | 'deleted'; data: { slug: string } }
  | { entity: 'plan'; action: 'created' | 'updated' | 'deleted'; data: { sessionId: string; fileName: string } };

// ============================================================
// Connection State
// ============================================================

export type CloudConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface CloudConnectionStatus {
  state: CloudConnectionState;
  error?: string;
  connectedClients?: number;
  lastSyncedAt?: number;
}
