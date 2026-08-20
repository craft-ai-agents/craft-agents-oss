/**
 * KnowledgeProvider contract: search/get/context types, mutation type records (P3, TYPE-ONLY
 * in P1 — no mutation channels/handlers exist yet), provider interface, and the provider registry.
 * All interfaces verbatim K-03 §§3.2–3.3 (docs/specs/2026-08-07-siyuan-integration/03-knowledge-provider-contract.md).
 */

import type { KnowledgeCapabilities } from './capabilities.ts';
import type { ContextMode, ContextPayload } from './context.ts';
import { KnowledgeError } from './errors.ts';
import type { ApplyResult, MutationInput, MutationProposal } from './mutations.ts';
import type { KnowledgeKind, KnowledgeRef } from './refs.ts';

// Mutation types moved to ./mutations.ts at P3 (K-05 §3.1/§3.4.1, pure engine); provider.ts re-exports
// them so existing imports from './provider.ts' (inmemory provider, siyuan adapter) keep working.
export type {
  ApplyResult,
  ConflictInfo,
  MutationActor,
  MutationInput,
  MutationOp,
  MutationOpKind,
  MutationProposal,
  MutationProposalFile,
  MutationProposalRecord,
  MutationProposalStatus,
  MutationRejectionReason,
  PreStateSnapshot,
  ProposalDiffDocument,
  ProposalDiffLine,
  SelectionProof,
  StatusHistoryEntry,
} from './mutations.ts';

// search (provider.ts)

export interface SearchInput {
  query: string;
  kinds?: KnowledgeKind[];        // default: ['document', 'block']
  notebookId?: string;
  pathPrefix?: string;            // '/Research/Reports'
  attributes?: Record<string, string>; // фильтр по SiYuan attributes (domain-сущности §4.3)
  limit?: number;                 // default 20, max 100
  cursor?: string;                // opaque курсор постраничности
}

export interface SearchHit {
  ref: KnowledgeRef;
  title: string;
  snippet: string;                // plain text с контекстом совпадения
  notebookPath: string;
  updatedAt: number;              // epoch ms
  score?: number;
  /** Optional domain attributes (viewRun enrichment for groupBy topic/status). */
  attributes?: Record<string, string>;
  /** Convenience mirror of attributes.topic when enriched. */
  topic?: string;
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor?: string;            // отсутствует = последняя страница
  totalEstimate?: number;
}

// get (provider.ts)

export interface KnowledgeAttribute { key: string; value: string; }

export interface KnowledgeNode {
  ref: KnowledgeRef;
  title: string;
  markdown?: string;              // для document/block
  parentRef?: KnowledgeRef;
  path: string;                   // '/Research/Reports/Craft × SiYuan'
  attributes: KnowledgeAttribute[];
  createdAt: number;
  updatedAt: number;
  contentHash: string;            // sha256 нормализованного markdown (см. Открытые вопросы)
  blockCount?: number;            // для document
}

// Mutation types (MutationOp/MutationInput/MutationProposal/ApplyResult/SelectionProof/…) live in
// ./mutations.ts at P3 (full K-05 engine) and are re-exported above — no second declaration here.

// KnowledgeProvider interface (att1 §9, verbatim)

export interface KnowledgeProvider {
  capabilities(): Promise<KnowledgeCapabilities>;
  search(input: SearchInput): Promise<SearchPage>;
  get(ref: KnowledgeRef): Promise<KnowledgeNode>;
  getContext(ref: KnowledgeRef, mode: ContextMode): Promise<ContextPayload>;
  proposeMutation(input: MutationInput): Promise<MutationProposal>;
  applyMutation(proposalId: string): Promise<ApplyResult>;
  open(ref: KnowledgeRef): Promise<void>;
}

// Content hashing — shared by KnowledgeNode.contentHash and MutationProposal.baseHash
// (sha256 of normalized markdown; K-05 §3.1 algorithm placeholder until mutation spec lands).

export function normalizeKnowledgeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').trim();
}

export async function hashKnowledgeContent(markdown: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalizeKnowledgeMarkdown(markdown)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Provider registry (verbatim K-03 §3.3)

export type KnowledgeProviderFactory = (connection: KnowledgeConnection) => KnowledgeProvider;

export interface KnowledgeConnection {
  id: string;                     // knowledge_connections.id (K-04)
  provider: string;               // 'siyuan'
  label: string;
  baseUrl?: string;               // external-local/remote режимы (K-07)
  status: 'connected' | 'degraded' | 'offline' | 'needs_auth';
}

export interface KnowledgeRegistry {
  registerProvider(scheme: string, factory: KnowledgeProviderFactory): void;
  connect(connection: KnowledgeConnection): Promise<KnowledgeProvider>;
  /** Разрешение ref → провайдер: по ref.provider/scheme, иначе default */
  resolve(ref: KnowledgeRef): KnowledgeProvider;
  defaultProvider(): KnowledgeProvider | null;
  list(): KnowledgeConnection[];
}

/**
 * In-process registry. MVP is a single SiYuan connection: the first connected
 * provider becomes the default, and `resolve` falls back to it when no explicit
 * connectionId/provider match exists — no API migration needed for multi-connection later.
 */
export function createKnowledgeRegistry(): KnowledgeRegistry {
  const factories = new Map<string, KnowledgeProviderFactory>();
  const connections = new Map<string, KnowledgeConnection>();
  const providers = new Map<string, KnowledgeProvider>();
  let defaultConnectionId: string | null = null;

  return {
    registerProvider(scheme, factory) {
      factories.set(scheme, factory);
    },
    async connect(connection) {
      const factory = factories.get(connection.provider);
      if (!factory) {
        throw new KnowledgeError(
          'UNSUPPORTED_OPERATION',
          `No knowledge provider factory registered for scheme "${connection.provider}"`,
        );
      }
      const provider = factory(connection);
      connections.set(connection.id, connection);
      providers.set(connection.id, provider);
      defaultConnectionId ??= connection.id;
      return provider;
    },
    resolve(ref) {
      if (ref.connectionId) {
        const byConnection = providers.get(ref.connectionId);
        if (byConnection) return byConnection;
      }
      const scheme = ref.provider ?? ref.scheme;
      for (const [id, connection] of connections) {
        if (connection.provider === scheme) {
          const provider = providers.get(id);
          if (provider) return provider;
        }
      }
      const fallback = defaultConnectionId ? providers.get(defaultConnectionId) : undefined;
      if (fallback) return fallback;
      throw new KnowledgeError('CONNECTION_UNAVAILABLE', `No knowledge provider connected for scheme "${scheme}"`);
    },
    defaultProvider() {
      if (!defaultConnectionId) return null;
      return providers.get(defaultConnectionId) ?? null;
    },
    list() {
      return [...connections.values()];
    },
  };
}
