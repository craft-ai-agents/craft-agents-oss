/**
 * Addressable refs: CraftRef and KnowledgeRef (+ mention/serialize/deep-link grammar).
 * Canonical types verbatim K-03 §3.1 (docs/specs/2026-08-07-siyuan-integration/03-knowledge-provider-contract.md).
 * This module is the single source of ref formats — do not invent ad-hoc ref strings elsewhere.
 */

import { KnowledgeError } from './errors.ts';

export type CraftRefKind = 'session' | 'run' | 'skill' | 'automation';

export interface CraftRef {
  scheme: 'craft';
  kind: CraftRefKind;
  id: string;
}

export type KnowledgeKind = 'notebook' | 'document' | 'block' | 'database' | 'asset';

export interface KnowledgeRef {
  /** att1 §3.3: всегда 'siyuan' для первой реализации; будущие провайдеры — свои scheme */
  scheme: 'siyuan';
  kind: KnowledgeKind;
  /** Стабильный id ядра SiYuan (document id / block id / notebook id) */
  id: string;
  /**
   * att1 §9 wire-форма. Присутствует в RPC-DTO; отсутствие == 'siyuan'.
   * Зарезервированные значения: 'siyuan' | 'obsidian' | 'notion' | 'memory' (InMemory).
   */
  provider?: string;
  /** Какое подключение (knowledge_connections.id, K-04) обслуживает ref; single-connection MVP */
  connectionId?: string;
}

/** Wire/provider form of the same ref (att1 §9: `provider` instead of `scheme`). */
export interface KnowledgeRefProviderForm {
  provider: string;
  kind: KnowledgeKind;
  id: string;
}

export const CRAFT_REF_KINDS: readonly CraftRefKind[] = ['session', 'run', 'skill', 'automation'];

export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = ['notebook', 'document', 'block', 'database', 'asset'];

/** Default provider for compact mentions `[knowledge:block/<id>]` — spec open-question decision (MVP). */
export const DEFAULT_KNOWLEDGE_PROVIDER = 'siyuan';

const PROVIDER_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/;

/** Token grammar for `[knowledge:<provider?/]<kind>/<id>]` mentions in message markdown. Verbatim §3.1. */
export const KNOWLEDGE_MENTION_PATTERN =
  /\[knowledge:(?:([a-z][a-z0-9-]*)\/)?(notebook|document|block|database|asset)\/([^\]\s]+)\]/g;

const isKnowledgeKind = (value: string): value is KnowledgeKind =>
  (KNOWLEDGE_KINDS as readonly string[]).includes(value);

const isCraftRefKind = (value: string): value is CraftRefKind =>
  (CRAFT_REF_KINDS as readonly string[]).includes(value);

/** 'siyuan/block/<id>' */
export function serializeKnowledgeRef(ref: KnowledgeRef): string {
  return `${ref.provider ?? ref.scheme}/${ref.kind}/${ref.id}`;
}

/**
 * Parses both the serialized form ('siyuan/block/<id>') and the compact form ('block/<id>').
 * Compact form resolves to the default provider ('siyuan'). Unknown shapes → null.
 */
export function parseKnowledgeRef(text: string): KnowledgeRef | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const [first, second, ...rest] = trimmed.split('/');
  if (!first || !second) return null;
  // Compact form: '<kind>/<id>' — kind segment first (provider names never collide with kinds).
  if (isKnowledgeKind(first)) {
    const id = [second, ...rest].join('/');
    return id ? { scheme: 'siyuan', kind: first, id } : null;
  }
  // Provider form: '<provider>/<kind>/<id>'
  if (PROVIDER_SEGMENT_PATTERN.test(first) && isKnowledgeKind(second)) {
    const id = rest.join('/');
    if (!id) return null;
    return first === DEFAULT_KNOWLEDGE_PROVIDER
      ? { scheme: 'siyuan', kind: second, id }
      : { scheme: 'siyuan', kind: second, id, provider: first };
  }
  return null;
}

/** 'craft/session/<id>' */
export function serializeCraftRef(ref: CraftRef): string {
  return `${ref.scheme}/${ref.kind}/${ref.id}`;
}

export function parseCraftRef(text: string): CraftRef | null {
  const [scheme, kind, ...rest] = text.trim().split('/');
  if (scheme !== 'craft' || !kind || !isCraftRefKind(kind)) return null;
  const id = rest.join('/');
  return id ? { scheme: 'craft', kind, id } : null;
}

/** '[knowledge:siyuan/block/<id>]' (or compact '[knowledge:block/<id>]' for the default provider). */
export function formatKnowledgeMention(ref: KnowledgeRef, options?: { compact?: boolean }): string {
  const provider = ref.provider ?? ref.scheme;
  const prefix = options?.compact && provider === DEFAULT_KNOWLEDGE_PROVIDER ? '' : `${provider}/`;
  return `[knowledge:${prefix}${ref.kind}/${ref.id}]`;
}

/** Extracts all knowledge mention tokens from message text. Compact tokens resolve to the default provider. */
export function parseKnowledgeMentions(text: string): KnowledgeRef[] {
  const refs: KnowledgeRef[] = [];
  for (const match of text.matchAll(KNOWLEDGE_MENTION_PATTERN)) {
    const provider = match[1];
    const kind = match[2];
    const id = match[3];
    if (!kind || !id || !isKnowledgeKind(kind)) continue;
    if (provider && provider !== DEFAULT_KNOWLEDGE_PROVIDER) {
      refs.push({ scheme: 'siyuan', kind, id, provider });
    } else {
      refs.push({ scheme: 'siyuan', kind, id });
    }
  }
  return refs;
}

/** '@siyuan/document/<id>' — readable form for UI (mention picker, badges, inspector). */
export function formatKnowledgeDisplay(ref: KnowledgeRef): string {
  return `@${serializeKnowledgeRef(ref)}`;
}

/**
 * External deep link into the native SiYuan editor. The real desktop protocol handler
 * (parseSiYuanUriInfo, app/src/util/pathName.ts @ siyuan-note/siyuan eef1056838) resolves ONLY
 * the `blocks` hostname: `siyuan://blocks/<\d{14}-\w{7}…>`. The `document`/`block` hostnames
 * Craft emitted pre-P3 are silently dropped upstream (parse → null) — never emit them again.
 * A SiYuan document IS its root block, so document refs open natively under the same
 * blocks/<id> grammar.
 */
export function siyuanDeepLink(ref: KnowledgeRef): string {
  if (ref.kind === 'document' || ref.kind === 'block') {
    return `siyuan://blocks/${ref.id}`;
  }
  // notebook/database/asset refs have no native surface (deep-links.ts policy route them
  // in-app): keep the legacy kind segment so the link stays parseable round-trip for callers
  // that only ever build in-app routes from it (audit targets, envelope keys).
  return `siyuan://${ref.kind}/${ref.id}`;
}

export function parseSiyuanDeepLink(href: string): KnowledgeRef | null {
  const prefix = 'siyuan://';
  if (!href.startsWith(prefix)) return null;
  const body = href.slice(prefix.length);
  // Native grammar (parseSiYuanUriInfo): hostname 'blocks'. A document's root id lives under
  // the same path, so the grammar alone cannot tell document from block (upstream resolves the
  // containing document at open time) — parse to 'block'; kind provenance is the caller's job.
  if (body.startsWith('blocks/')) {
    const id = body.slice('blocks/'.length);
    return id ? { scheme: 'siyuan', kind: 'block', id } : null;
  }
  // Legacy Craft-emitted grammar (siyuan://document/<id>, siyuan://block/<id>): the native
  // handler never accepted these, but previously persisted strings (audit logs, envelopes)
  // still resolve here. Body is the compact ref form; parseKnowledgeRef resolves the provider.
  return parseKnowledgeRef(body);
}

/** Accepts canonical or provider (wire) form; returns the canonical KnowledgeRef. Throws INVALID_REF on bad input. */
export function canonicalKnowledgeRef(input: KnowledgeRef | KnowledgeRefProviderForm): KnowledgeRef {
  if ('scheme' in input) {
    return validateKnowledgeRef(input);
  }
  return validateKnowledgeRef(
    input.provider === DEFAULT_KNOWLEDGE_PROVIDER
      ? { scheme: 'siyuan', kind: input.kind, id: input.id }
      : { scheme: 'siyuan', kind: input.kind, id: input.id, provider: input.provider },
  );
}

/** Canonical → provider (wire) form. */
export function toProviderForm(ref: KnowledgeRef): KnowledgeRefProviderForm {
  return { provider: ref.provider ?? ref.scheme, kind: ref.kind, id: ref.id };
}

/** Structural validation; throws a typed KnowledgeError (INVALID_REF) instead of returning null. */
export function validateKnowledgeRef(ref: unknown): KnowledgeRef {
  if (typeof ref !== 'object' || ref === null) {
    throw new KnowledgeError('INVALID_REF', 'Knowledge ref must be an object', ref);
  }
  const candidate = ref as Record<string, unknown>;
  if (candidate['scheme'] !== 'siyuan') {
    throw new KnowledgeError('INVALID_REF', `Unsupported knowledge scheme: ${String(candidate['scheme'])}`, ref);
  }
  if (typeof candidate['kind'] !== 'string' || !isKnowledgeKind(candidate['kind'])) {
    throw new KnowledgeError('INVALID_REF', `Unsupported knowledge kind: ${String(candidate['kind'])}`, ref);
  }
  if (typeof candidate['id'] !== 'string' || candidate['id'].length === 0) {
    throw new KnowledgeError('INVALID_REF', 'Knowledge ref id must be a non-empty string', ref);
  }
  const provider = candidate['provider'];
  if (provider !== undefined && (typeof provider !== 'string' || !PROVIDER_SEGMENT_PATTERN.test(provider))) {
    throw new KnowledgeError('INVALID_REF', `Invalid knowledge provider segment: ${String(provider)}`, ref);
  }
  if (candidate['connectionId'] !== undefined && typeof candidate['connectionId'] !== 'string') {
    throw new KnowledgeError('INVALID_REF', 'Knowledge ref connectionId must be a string', ref);
  }
  return ref as KnowledgeRef;
}
