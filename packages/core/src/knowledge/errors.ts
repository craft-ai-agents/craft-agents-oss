/**
 * Knowledge provider error model.
 * Verbatim K-03 §3.2 (docs/specs/2026-08-07-siyuan-integration/03-knowledge-provider-contract.md).
 */

export type KnowledgeErrorCode =
  | 'CONNECTION_UNAVAILABLE'
  | 'UNSUPPORTED_OPERATION' // capability выключена (P1: все mutations)
  | 'NOT_FOUND'
  | 'HASH_CONFLICT'
  | 'INVALID_REF'
  | 'CAPABILITY_DISABLED' // запрещено permissions.json
  | 'PROVIDER_ERROR';

export class KnowledgeError extends Error {
  constructor(
    readonly code: KnowledgeErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'KnowledgeError';
  }
}
