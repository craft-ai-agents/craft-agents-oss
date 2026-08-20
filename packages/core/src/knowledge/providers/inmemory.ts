/**
 * InMemoryKnowledgeProvider — full in-memory implementation of the KnowledgeProvider
 * contract (K-03 §3.3: «полная реализация в памяти для unit/component-тестов»).
 *
 * Mutation semantics (documented choice): the provider implements the full READ → CAPTURE BASE
 * HASH → proposal lifecycle in memory, running the P3 engine (../mutations.ts) for the status
 * machine. proposeMutation creates a draft and builds the diff (draft → pending_review);
 * applyMutation auto-approves (the human approval + permission gates live in bridge-service —
 * a provider test double models the stage AFTER them), then does RE-READ → HASH CHECK → APPLY →
 * verify, reporting conflict on hash drift. Selection-proof guards are bridge-side too
 * (spec §3.4.1), so the engine is created with enforceSelectionProofs=false here. Nothing is persisted.
 */

import type { KnowledgeCapabilities } from '../capabilities.ts';
import type { ContextMode, ContextPayload } from '../context.ts';
import { KnowledgeError } from '../errors.ts';
import {
  computeInverseOps,
  createProposalDraft,
  transition,
  validateOpsWhitelist,
  type MutationOpKind,
} from '../mutations.ts';
import {
  hashKnowledgeContent,
  type ApplyResult,
  type KnowledgeNode,
  type KnowledgeProvider,
  type MutationInput,
  type MutationProposal,
  type SearchInput,
  type SearchPage,
} from '../provider.ts';
import { siyuanDeepLink, validateKnowledgeRef, type KnowledgeRef } from '../refs.ts';

export interface InMemoryKnowledgeLink {
  /** source node references target node → target's backlinks include source */
  sourceId: string;
  targetId: string;
}

export interface InMemoryKnowledgeSeed {
  nodes?: KnowledgeNode[];
  links?: InMemoryKnowledgeLink[];
}

export interface InMemoryKnowledgeProviderOptions {
  connectionId?: string;
  capabilities?: KnowledgeCapabilities;
  seed?: InMemoryKnowledgeSeed;
}

interface PendingMutation {
  targetId: string | null;
  preAllocatedId?: string;
}

function snippetOf(node: KnowledgeNode, query: string): string {
  const text = (node.markdown ?? node.title).replace(/\s+/g, ' ').trim();
  const index = query ? text.toLowerCase().indexOf(query) : -1;
  const start = index > 40 ? index - 40 : 0;
  const end = index >= 0 ? index + query.length + 40 : 80;
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

export class InMemoryKnowledgeProvider implements KnowledgeProvider {
  readonly connectionId: string;
  /** Test hook: deep links recorded by open() in call order. */
  readonly openedDeepLinks: string[] = [];

  private readonly nodes = new Map<string, KnowledgeNode>();
  private readonly links: InMemoryKnowledgeLink[] = [];
  private readonly proposals = new Map<string, MutationProposal>();
  private readonly pendingMutations = new Map<string, PendingMutation>();
  private readonly caps: KnowledgeCapabilities;
  private sequence = 0;

  constructor(options: InMemoryKnowledgeProviderOptions = {}) {
    this.connectionId = options.connectionId ?? 'inmemory';
    this.caps = options.capabilities ?? {
      provider: 'memory',
      version: '0.0.0-inmemory',
      minSupportedVersion: '0.0.0',
      features: {
        search: true,
        backlinks: true,
        attributes: true,
        databases: true,
        assets: true,
        liveReference: true,
        watch: false,
        deepLinks: true,
      },
      mutations: {
        createDocument: true,
        appendBlock: true,
        updateBlock: true,
        setAttribute: true,
        transactions: false,
        rollback: true,
      },
    };
    this.seed(options.seed ?? {});
  }

  /** Bulk load; can also be used between calls as a test hook that replaces a node. */
  seed(seed: InMemoryKnowledgeSeed): void {
    for (const node of seed.nodes ?? []) {
      this.nodes.set(node.ref.id, structuredClone(node));
    }
    for (const link of seed.links ?? []) {
      this.links.push({ ...link });
    }
  }

  async capabilities(): Promise<KnowledgeCapabilities> {
    return structuredClone(this.caps);
  }

  async search(input: SearchInput): Promise<SearchPage> {
    const kinds = input.kinds ?? ['document', 'block'];
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    const query = input.query.trim().toLowerCase();

    const matched = [...this.nodes.values()].filter((node) => {
      if (!kinds.includes(node.ref.kind)) return false;
      if (input.notebookId && this.notebookIdOf(node) !== input.notebookId) return false;
      if (input.pathPrefix && !node.path.startsWith(input.pathPrefix)) return false;
      if (input.attributes) {
        for (const [key, value] of Object.entries(input.attributes)) {
          if (node.attributes.find((attribute) => attribute.key === key)?.value !== value) return false;
        }
      }
      if (query && !`${node.title}\n${node.markdown ?? ''}`.toLowerCase().includes(query)) return false;
      return true;
    });
    matched.sort((a, b) => b.updatedAt - a.updatedAt || a.ref.id.localeCompare(b.ref.id));

    const items = matched.slice(offset, offset + limit).map((node) => {
      const notebookId = this.notebookIdOf(node);
      return {
        ref: { ...node.ref },
        title: node.title,
        snippet: snippetOf(node, query),
        notebookPath: notebookId ? (this.nodes.get(notebookId)?.path ?? '') : '',
        updatedAt: node.updatedAt,
      };
    });
    const page: SearchPage = { items, totalEstimate: matched.length };
    if (offset + limit < matched.length) page.nextCursor = String(offset + limit);
    return page;
  }

  async get(ref: KnowledgeRef): Promise<KnowledgeNode> {
    const node = structuredClone(this.nodeOrThrow(validateKnowledgeRef(ref).id));
    if (node.ref.kind === 'document') node.blockCount = this.childrenOf(node.ref.id).length;
    return node;
  }

  async getContext(ref: KnowledgeRef, mode: ContextMode): Promise<ContextPayload> {
    if (mode === 'live-reference' && !this.caps.features.liveReference) {
      throw new KnowledgeError(
        'UNSUPPORTED_OPERATION',
        `Provider "${this.caps.provider}" does not support live-reference context`,
      );
    }
    const node = await this.get(ref);
    const markdown = node.markdown ?? '';
    const backlinks: ContextPayload['backlinks'] = [];
    for (const link of this.links) {
      if (link.targetId !== node.ref.id) continue;
      const source = this.nodes.get(link.sourceId);
      if (source) backlinks.push({ ref: { ...source.ref }, title: source.title });
    }
    return {
      ref,
      mode,
      blockId: node.ref.id,
      content: markdown,
      children: this.childrenOf(node.ref.id).map((child) => ({ blockId: child.ref.id, content: child.markdown ?? '' })),
      backlinks,
      attributes: node.attributes.map((attribute) => ({ ...attribute })),
      capturedAt: Date.now(),
      contentHash: await hashKnowledgeContent(markdown),
    };
  }

  async proposeMutation(input: MutationInput): Promise<MutationProposal> {
    const ops = validateOpsWhitelist(input.ops); // shape guard; per-op proof/permissions guards are bridge-side
    const capabilityByOp: Record<MutationOpKind, boolean> = {
      createDocument: this.caps.mutations.createDocument,
      appendBlock: this.caps.mutations.appendBlock,
      updateBlock: this.caps.mutations.updateBlock,
      setAttribute: this.caps.mutations.setAttribute,
    };
    if (ops.length > 1 && !this.caps.mutations.transactions) {
      throw new KnowledgeError('UNSUPPORTED_OPERATION', `Provider "${this.caps.provider}" supports one op per proposal (transactions=false)`);
    }
    if (ops.length === 0) throw new KnowledgeError('INVALID_REF', 'Mutation proposal needs at least one op');
    for (const candidate of ops) {
      if (!capabilityByOp[candidate.op]) {
        throw new KnowledgeError('UNSUPPORTED_OPERATION', `Provider "${this.caps.provider}" does not support mutation "${candidate.op}"`);
      }
    }
    const op = ops[0]!;

    const id = `inmem-proposal-${++this.sequence}`;
    const baseReadAt = new Date().toISOString();
    let targetRef: KnowledgeRef;
    let preAllocatedId: string | undefined;
    let pendingTargetId: string | null;
    let preState: string;
    let preStateAttributes: Record<string, Record<string, string>> | undefined;

    if (op.op === 'createDocument') {
      const notebook = this.nodeOrThrow(op.notebook);
      if (notebook.ref.kind !== 'notebook') {
        throw new KnowledgeError('INVALID_REF', `Mutation "createDocument" needs a notebook target, got ${notebook.ref.kind} "${op.notebook}"`);
      }
      // Pre-allocate the document id. Wire targetRef on the provider proposal is the NEW document
      // (historical InMemory contract); bridge RE-READ uses its own notebook-scoped proposal.
      preAllocatedId = `inmem-document-${++this.sequence}`;
      targetRef = { scheme: 'siyuan', kind: 'document', id: preAllocatedId };
      preState = '';
      pendingTargetId = null;
    } else {
      if (!input.targetRef) {
        throw new KnowledgeError('INVALID_REF', `Mutation "${op.op}" requires targetRef`);
      }
      const target = this.nodeOrThrow(validateKnowledgeRef(input.targetRef).id);
      const opTargetId = op.op === 'appendBlock' ? op.documentId : op.blockId;
      if (opTargetId !== target.ref.id && !opTargetId.startsWith('$insertedBlockId[')) {
        throw new KnowledgeError('INVALID_REF', `Mutation target "${opTargetId}" does not match targetRef "${target.ref.id}"`);
      }
      targetRef = { ...target.ref };
      preState = target.markdown ?? '';
      preStateAttributes = { [target.ref.id]: Object.fromEntries(target.attributes.map((attribute) => [attribute.key, attribute.value])) };
      if (op.op === 'appendBlock') preAllocatedId = `inmem-block-${++this.sequence}`;
      pendingTargetId = target.ref.id;
    }
    const baseHash = await hashKnowledgeContent(preState);

    const draft = createProposalDraft(
      {
        id,
        connectionId: this.connectionId,
        targetRef,
        ops,
        baseHash,
        baseReadAt,
        preState,
        preStateAttributes,
        sessionId: input.sessionId,
        actor: input.actor ?? 'user',
      },
      { enforceSelectionProofs: false },
    );
    const built = transition(draft.proposal, { type: 'buildDiff' });
    this.proposals.set(id, built.proposal);
    this.pendingMutations.set(id, { targetId: pendingTargetId, preAllocatedId });
    return structuredClone(built.proposal);
  }

  async applyMutation(proposalId: string): Promise<ApplyResult> {
    const stored = this.proposals.get(proposalId);
    if (!stored) throw new KnowledgeError('NOT_FOUND', `Mutation proposal "${proposalId}" not found`);
    const pending = this.pendingMutations.get(proposalId);
    if (!pending) throw new KnowledgeError('PROVIDER_ERROR', `Mutation proposal "${proposalId}" lost its pending op`);

    // Auto-approve (T3) — documented InMemory shortcut: approval/permission gates are bridge-side.
    let working = stored;
    if (working.status === 'pending_review') working = transition(working, { type: 'approve' }).proposal;
    if (working.status !== 'approved') {
      throw new KnowledgeError('PROVIDER_ERROR', `Mutation proposal "${proposalId}" is ${working.status}, cannot apply`);
    }
    working = transition(working, { type: 'beginApply' }).proposal;
    const ops = working.ops;
    if (ops.length === 0) throw new KnowledgeError('PROVIDER_ERROR', `Mutation proposal "${proposalId}" lost its op`);
    const head = ops[0]!;

    // RE-READ + HASH CHECK. createDocument was absent at READ → hash of '' (no prior content to protect).
    let reReadContent = '';
    if (head.op !== 'createDocument') {
      const target = pending.targetId ? this.nodes.get(pending.targetId) : undefined;
      if (!target) throw new KnowledgeError('NOT_FOUND', `Mutation target "${pending.targetId}" no longer exists`);
      reReadContent = target.markdown ?? '';
    }
    const actualHash = await hashKnowledgeContent(reReadContent);
    working = transition(working, { type: 'resolveHashCheck', actualHash, currentContent: reReadContent }).proposal;
    if (working.status === 'conflict') {
      this.proposals.set(proposalId, working);
      return { proposalId, applied: false, conflicted: true, status: 'conflict', reason: 'hash-mismatch', currentHash: actualHash };
    }

    const nowMs = Date.now();
    const appliedAt = new Date(nowMs).toISOString();
    let createdRef: KnowledgeRef | undefined;
    const createdByIndex: Record<number, string> = {};

    const resolveId = (value: string): string =>
      value.replace(/\$insertedBlockId\[(\d+)\]/g, (match, digits: string) => createdByIndex[Number(digits)] ?? pending.preAllocatedId ?? match);

    for (let index = 0; index < ops.length; index++) {
      const op = ops[index]!;
      if (op.op === 'createDocument') {
        const notebook = this.nodeOrThrow(op.notebook);
        const newId = index === 0 && pending.preAllocatedId ? pending.preAllocatedId : `inmem-document-${++this.sequence}`;
        createdByIndex[index] = newId;
        createdRef = { scheme: 'siyuan', kind: 'document', id: newId };
        this.nodes.set(newId, {
          ref: createdRef,
          title: op.title,
          markdown: op.markdown,
          parentRef: { ...notebook.ref },
          path: op.path,
          attributes: [],
          createdAt: nowMs,
          updatedAt: nowMs,
          contentHash: await hashKnowledgeContent(op.markdown),
          blockCount: 0,
        });
      } else if (op.op === 'appendBlock') {
        const parentId = resolveId(op.documentId);
        const parent = this.nodeOrThrow(parentId);
        const childId = index === 0 && pending.preAllocatedId ? pending.preAllocatedId : `inmem-block-${++this.sequence}`;
        createdByIndex[index] = childId;
        parent.updatedAt = nowMs;
        parent.contentHash = await hashKnowledgeContent(parent.markdown ?? '');
        const childRef: KnowledgeRef = { scheme: 'siyuan', kind: 'block', id: childId };
        if (!createdRef) createdRef = childRef;
        this.nodes.set(childId, {
          ref: childRef,
          title: (op.markdown.split('\n')[0] ?? '').slice(0, 80),
          markdown: op.markdown,
          parentRef: { ...parent.ref },
          path: `${parent.path}/${childId}`,
          attributes: [],
          createdAt: nowMs,
          updatedAt: nowMs,
          contentHash: await hashKnowledgeContent(op.markdown),
        });
      } else if (op.op === 'updateBlock') {
        const target = this.nodeOrThrow(resolveId(op.blockId));
        target.markdown = op.markdown;
        target.updatedAt = nowMs;
        target.contentHash = await hashKnowledgeContent(op.markdown);
      } else {
        const target = this.nodeOrThrow(resolveId(op.blockId));
        const existing = target.attributes.find((attribute) => attribute.key === op.name);
        if (existing) existing.value = op.value;
        else target.attributes.push({ key: op.name, value: op.value });
        target.updatedAt = nowMs;
      }
    }

    if (Object.keys(createdByIndex).length > 0 || pending.preAllocatedId !== undefined) {
      const inserted = { ...createdByIndex };
      if (pending.preAllocatedId !== undefined && inserted[0] === undefined) inserted[0] = pending.preAllocatedId;
      working = {
        ...working,
        inverseOps: computeInverseOps(
          { content: working.preState ?? '', attributes: working.preStateAttributes },
          working.ops,
          { insertedBlockIds: inserted, at: appliedAt },
        ),
      };
    }
    // Same-reader post-hash: original target (notebook/doc), not the created child.
    const verifyId = pending.targetId ?? working.targetRef.id;
    const verifyNode = this.nodes.get(verifyId);
    const postHash = await hashKnowledgeContent(verifyNode?.markdown ?? '');
    working = transition(working, { type: 'applyOpsSucceeded', postHash }).proposal;
    this.proposals.set(proposalId, working);
    const result: ApplyResult = { proposalId, applied: true, conflicted: false, status: 'applied', appliedAt };
    if (createdRef) result.createdRef = createdRef;
    return result;
  }

  async open(ref: KnowledgeRef): Promise<void> {
    const valid = validateKnowledgeRef(ref);
    this.nodeOrThrow(valid.id);
    this.openedDeepLinks.push(siyuanDeepLink(valid));
  }

  private nodeOrThrow(id: string): KnowledgeNode {
    const node = this.nodes.get(id);
    if (!node) throw new KnowledgeError('NOT_FOUND', `Knowledge node "${id}" not found`);
    return node;
  }

  private childrenOf(id: string): KnowledgeNode[] {
    return [...this.nodes.values()].filter((node) => node.parentRef?.id === id);
  }

  private notebookIdOf(node: KnowledgeNode): string | undefined {
    let current = node;
    const seen = new Set<string>([current.ref.id]);
    while (current.parentRef) {
      const parent = this.nodes.get(current.parentRef.id);
      if (!parent || seen.has(parent.ref.id)) return undefined;
      if (parent.ref.kind === 'notebook') return parent.ref.id;
      seen.add(parent.ref.id);
      current = parent;
    }
    return undefined;
  }
}
