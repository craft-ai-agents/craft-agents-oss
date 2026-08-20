/**
 * @craft-agent/core/knowledge/providers/siyuan — SiYuan kernel provider subpath (KP1Siyuan).
 *
 * - ./client.ts: typed SiYuan kernel REST client (verified against kernel router.go, own header).
 * - ./deep-links.ts: siyuan:// deep-link policy + canonical open() error (K-03 §3.5.3).
 * - ./adapter.ts: KnowledgeProvider over the client — P1 read surface + P3 write-back
 *   (proposeMutation/applyMutation driving the kernel via ./mutation-adapter.ts).
 * - ./mutation-adapter.ts: sequential MutationOp executor + soft partial-apply compensation (P3).
 */

export * from './client.ts';
export * from './deep-links.ts';
export * from './adapter.ts';
export * from './mutation-adapter.ts';
