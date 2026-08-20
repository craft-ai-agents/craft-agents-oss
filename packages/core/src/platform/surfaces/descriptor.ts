/**
 * SurfaceTab ↔ SurfaceDescriptor mapping and durable identity
 * (S-02 §3.2 downgrade rules, §3.7 durable refs).
 */

import type { SurfaceDescriptor, SurfaceTab } from './types.ts';

/**
 * UI-level tab → host-level descriptor (S-02 §3.2):
 * - 'session'  → 'chat';
 * - 'database' → 'knowledge' with ref.kind 'database';
 * - 'extension' → null: extension views render through the plugin-bridge
 *   sandbox; they are not part of the host descriptor union.
 */
export function surfaceTabToDescriptor(tab: SurfaceTab): SurfaceDescriptor | null {
  switch (tab.kind) {
    case 'session':
      return { kind: 'chat', sessionId: tab.sessionId };
    case 'browser':
      return { kind: 'browser', tabId: tab.tabId };
    case 'knowledge':
      return { kind: 'knowledge', ref: tab.ref };
    case 'database':
      return { kind: 'knowledge', ref: { scheme: tab.ref.scheme, kind: 'database', id: tab.ref.id } };
    case 'cloud-run':
      return { kind: 'cloud-run', runId: tab.runId };
    case 'diff':
      return { kind: 'diff', proposalId: tab.proposalId };
    case 'extension':
      return null;
  }
}

/**
 * Default dedup key over the durable ref (S-02 §3.7): what gets serialized
 * and survives restart — never an ephemeral instance id. Contributions may
 * override via policy.singletonPer; this is the shared default.
 */
export function surfaceTabDurableKey(tab: SurfaceTab): string {
  switch (tab.kind) {
    case 'session':
      return `session:${tab.sessionId}`;
    case 'browser':
      return `browser:${tab.tabId}`;
    case 'knowledge':
      return `knowledge:siyuan/${tab.ref.kind}/${tab.ref.id}`;
    case 'database':
      return `database:siyuan/${tab.ref.kind}/${tab.ref.id}`;
    case 'cloud-run':
      return `cloud-run:${tab.runId}`;
    case 'extension':
      return `extension:${tab.extensionId}/${tab.viewId}`;
    case 'diff':
      return `diff:${tab.proposalId}`;
  }
}
