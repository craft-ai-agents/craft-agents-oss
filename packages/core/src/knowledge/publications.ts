/**
 * Publication pipeline types (P4, K-06) — pure contracts, no I/O.
 * Canonical home for PublishDraft / PublicationRecord / KnowledgeLinkRecord.
 * Wire DTOs re-export these from @craft-agent/shared/protocol.
 */
import type { CraftRef, KnowledgeRef } from './refs.ts';

export type PublicationStatus =
  | 'distilling'
  | 'draft'
  | 'target_pending'
  | 'publishing'
  | 'published'
  | 'conflict'
  | 'failed';

/** Re-export CraftRef so consumers of the publications surface need one import. */
export type { CraftRef };

export type KnowledgeLinkRelation =
  | 'published-from'
  | 'context-of'
  | 'derived-from'
  | 'reviews'
  | 'tracked-by';

export interface KnowledgeLinkRecord {
  id: string;
  craftRef: CraftRef;
  knowledgeRef: KnowledgeRef;
  relation: KnowledgeLinkRelation;
  createdAt: string; // ISO
}

export type ExcludeReason =
  | 'credential-like'
  | 'pii'
  | 'raw-transcript'
  | 'unverified-claim'
  | 'internal-id'
  | 'size-cap';

export interface ExcludedFragment {
  reason: ExcludeReason;
  /** sha256 hex of excluded text; raw text NEVER stored */
  excerptHash: string;
  origin: 'session' | 'run-artifact' | 'source-block';
}

export interface PublishDraft {
  id: string; // draft_<uuid>
  status: PublicationStatus;
  sessionId?: string;
  runIds: string[];
  connectionId: string;
  title: string;
  markdown: string;
  summary: string;
  outline: Array<{ heading: string; blockCount: number }>;
  sourceBlocks: string[]; // siyuan://blocks/...
  sourceMessages: Array<{ sessionId: string; messageId: string }>;
  excluded: ExcludedFragment[];
  contentHash: string; // sha256(markdown)
  model: { connectionSlug: string; modelId: string };
  createdAt: number;
  updatedAt: number;
  // target (filled by PREPARE)
  targetNotebookId?: string;
  targetPath?: string; // document path within notebook
  targetDocId?: string;
  mode?: 'create' | 'update';
  baseHash?: string;
  proposalId?: string;
  publicationId?: string;
  supersededBy?: string;
  lastError?: string;
}

export interface PublicationProvenance {
  source_session_id?: string;
  source_run_ids: string[];
  published_at: string;
  generated_by: { provider: string; model: string };
  source_blocks: string[];
  content_hash: string;
}

export interface PublicationRecord {
  id: string; // pub_<uuid>
  sessionId?: string;
  runId?: string;
  draftId: string;
  connectionId: string;
  targetRef: KnowledgeRef;
  mode: 'create' | 'update';
  contentHash: string;
  proposalId: string;
  provenance: PublicationProvenance;
  createdAt: string;
}

export interface PublishPrepareResult {
  mode: 'create' | 'update' | 'adopt-required';
  docId?: string;
  baseHash?: string;
  existingTitle?: string;
}

export interface PublishApplyResult {
  proposalId: string;
  status: PublicationStatus;
  publicationId?: string;
  docRef?: KnowledgeRef;
}

/** Distill input message (session transcript slice). */
export interface DistillMessage {
  id: string;
  role: string;
  content: string;
}

export interface DistillFromMessagesOptions {
  sessionId?: string;
  runIds?: string[];
  connectionId: string;
  language?: string;
  model?: { connectionSlug: string; modelId: string };
  /** Wall-clock ms; injectable for tests. */
  now?: number;
  /** Draft id override (tests). Default draft_<uuid>. */
  draftId?: string;
}

export const PUBLISH_MARKDOWN_MAX_CHARS = 256_000;

const CREDENTIAL_RE =
  /(?:bearer\s+[a-z0-9._\-+=\/]{8,}|sk-[a-zA-Z0-9]{16,}|api[_-]?key\s*[:=]\s*\S+|-----BEGIN[A-Z0-9\s]+PRIVATE KEY-----|-----BEGIN\s+CERTIFICATE-----)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}(?!\w)/;
const INTERNAL_ID_RE = /\b(?:msg_|sess_|run_|draft_|pub_)[a-zA-Z0-9_-]+\b/g;
const TOOL_DUMP_RE = /^\s*(?:Error:|at\s+\S+\s+\(|\{[\s\S]*"tool_call"|\{\s*"name"\s*:\s*"[^"]+"\s*,)/m;

function sha256Hex(text: string): string {
  // Prefer WebCrypto when available (browser/bun); fall back to a sync Node path via subtle is async —
  // distill is pure/sync so we use a compact FNV-independent approach via TextEncoder + a tiny
  // SHA-256 when crypto.subtle is unavailable synchronously. Bun exposes crypto.hash.
  const g = globalThis as typeof globalThis & {
    crypto?: Crypto & { hash?: (alg: string, data: string | ArrayBufferView, out?: string) => string | ArrayBuffer };
    Bun?: { sha?: (input: string | Uint8Array, encoding?: string) => string | Uint8Array };
  };
  if (typeof g.Bun?.sha === 'function') {
    return String(g.Bun.sha(text, 'hex'));
  }
  if (typeof g.crypto?.hash === 'function') {
    return String(g.crypto.hash('sha256', text, 'hex'));
  }
  // Last-resort deterministic non-crypto hash only used if neither Bun nor crypto.hash exist
  // (should not happen in this monorepo's runtimes). Still produces a stable hex string.
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c << 1), 0x01000193) >>> 0;
  }
  return (
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    (h1 ^ h2).toString(16).padStart(8, '0') +
    ((h1 + h2) >>> 0).toString(16).padStart(8, '0') +
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    (h1 ^ h2).toString(16).padStart(8, '0') +
    ((h1 + h2) >>> 0).toString(16).padStart(8, '0')
  );
}

export function hashExcerpt(text: string): string {
  return sha256Hex(text);
}

export function hashMarkdownContent(markdown: string): string {
  return sha256Hex(markdown);
}

function isCredentialLike(text: string): boolean {
  return CREDENTIAL_RE.test(text);
}

function isStandalonePii(text: string): boolean {
  const trimmed = text.trim();
  // Only flag when the whole line/paragraph is essentially just the PII token.
  if (EMAIL_RE.test(trimmed) && trimmed.replace(EMAIL_RE, '').trim().length < 8) return true;
  if (PHONE_RE.test(trimmed) && trimmed.replace(PHONE_RE, '').trim().length < 8 && /\d{7,}/.test(trimmed)) return true;
  return false;
}

function isRawTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 500) {
    // pure JSON blob
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        /* not pure JSON */
      }
    }
  }
  if (TOOL_DUMP_RE.test(trimmed)) return true;
  // stack-trace-ish: multiple "at foo (file:line)" lines
  const atLines = trimmed.split('\n').filter((l) => /^\s*at\s+\S+/.test(l));
  if (atLines.length >= 3) return true;
  return false;
}

function stripInternalIds(text: string, excluded: ExcludedFragment[], origin: ExcludedFragment['origin']): string {
  return text.replace(INTERNAL_ID_RE, (match) => {
    // bare internal ids only — keep when embedded in prose longer sentences? Spec: internal ids alone.
    excluded.push({ reason: 'internal-id', excerptHash: hashExcerpt(match), origin });
    return '';
  });
}

function classifyAndFilter(
  text: string,
  origin: ExcludedFragment['origin'],
  excluded: ExcludedFragment[],
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (isCredentialLike(trimmed)) {
    excluded.push({ reason: 'credential-like', excerptHash: hashExcerpt(trimmed), origin });
    return null;
  }
  if (isStandalonePii(trimmed)) {
    excluded.push({ reason: 'pii', excerptHash: hashExcerpt(trimmed), origin });
    return null;
  }
  if (isRawTranscript(trimmed)) {
    excluded.push({ reason: 'raw-transcript', excerptHash: hashExcerpt(trimmed), origin });
    return null;
  }
  const cleaned = stripInternalIds(trimmed, excluded, origin).replace(/[ \t]+\n/g, '\n').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function extractOutline(markdown: string): Array<{ heading: string; blockCount: number }> {
  const lines = markdown.split('\n');
  const outline: Array<{ heading: string; blockCount: number }> = [];
  let current: { heading: string; blockCount: number } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) outline.push(current);
      current = { heading: m[1]!, blockCount: 0 };
      continue;
    }
    if (current && line.trim().length > 0) current.blockCount += 1;
  }
  if (current) outline.push(current);
  return outline;
}

function firstHeadingOrGoal(markdown: string, userGoals: string[]): string {
  const h1 = /^#\s+(.+?)\s*$/m.exec(markdown);
  if (h1) return h1[1]!.slice(0, 120);
  const h2 = /^##\s+(.+?)\s*$/m.exec(markdown);
  if (h2) return h2[1]!.slice(0, 120);
  const goal = userGoals[0]?.replace(/\s+/g, ' ').trim();
  if (goal) return goal.slice(0, 80) + (goal.length > 80 ? '…' : '');
  return 'Untitled publication';
}

function buildSummary(paragraphs: string[]): string {
  const sentences: string[] = [];
  for (const p of paragraphs) {
    const parts = p
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of parts) {
      sentences.push(s);
      if (sentences.length >= 3) break;
    }
    if (sentences.length >= 3) break;
  }
  if (sentences.length === 0) return '';
  return sentences.slice(0, 3).join(' ');
}

/**
 * Deterministic distill engine (NO live LLM in P4).
 * Prefer substantial assistant content; user messages as goals/context.
 * Excludes credentials/PII/raw dumps/internal ids; enforces size-cap and source presence.
 */
export function distillFromMessages(
  messages: readonly DistillMessage[],
  opts: DistillFromMessagesOptions,
): Omit<PublishDraft, 'id' | 'status' | 'createdAt' | 'updatedAt'> & {
  id: string;
  status: PublicationStatus;
  createdAt: number;
  updatedAt: number;
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('distillFromMessages: messages required (at least one source message)');
  }

  const excluded: ExcludedFragment[] = [];
  const sourceMessages: Array<{ sessionId: string; messageId: string }> = [];
  const sessionId = opts.sessionId;
  const userGoals: string[] = [];
  const bodyParts: string[] = [];

  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const role = (msg.role ?? '').toLowerCase();
    const origin: ExcludedFragment['origin'] = 'session';

    if (role === 'user') {
      const kept = classifyAndFilter(msg.content, origin, excluded);
      if (kept) {
        userGoals.push(kept);
        if (sessionId && msg.id) sourceMessages.push({ sessionId, messageId: msg.id });
      }
      continue;
    }

    if (role === 'assistant' || role === 'system' || role === 'model') {
      // Prefer substantial assistant content (>= 40 chars after trim)
      const kept = classifyAndFilter(msg.content, origin, excluded);
      if (!kept) continue;
      if (kept.length < 40 && role !== 'assistant') continue;
      bodyParts.push(kept);
      if (sessionId && msg.id) sourceMessages.push({ sessionId, messageId: msg.id });
      continue;
    }

    // tool / other roles — treat as raw-transcript candidates
    const kept = classifyAndFilter(msg.content, origin, excluded);
    if (kept && kept.length >= 80) {
      bodyParts.push(kept);
      if (sessionId && msg.id) sourceMessages.push({ sessionId, messageId: msg.id });
    } else if (msg.content.trim().length > 0 && !kept) {
      // already excluded
    } else if (msg.content.trim().length > 0) {
      excluded.push({ reason: 'raw-transcript', excerptHash: hashExcerpt(msg.content), origin });
    }
  }

  // Require at least one sourceMessages entry OR refuse.
  // If sessionId absent (run-only), synthesize source from message ids under a synthetic session key.
  if (sourceMessages.length === 0) {
    // Fall back: if we have body content from messages with ids, attach under sessionId or 'run'
    for (const msg of messages) {
      if (!msg?.id || !msg.content?.trim()) continue;
      const kept = classifyAndFilter(msg.content, 'session', excluded);
      if (kept) {
        sourceMessages.push({ sessionId: sessionId ?? 'run', messageId: msg.id });
        if (bodyParts.length === 0) bodyParts.push(kept);
        break;
      }
    }
  }

  if (sourceMessages.length === 0) {
    throw new Error(
      'distillFromMessages: refused — no sourceMessages (need at least one message id after exclusion filters)',
    );
  }

  // Assemble markdown: optional goal context + assistant body
  const sections: string[] = [];
  if (userGoals.length > 0) {
    sections.push(`## Context\n\n${userGoals.slice(0, 3).join('\n\n')}`);
  }
  if (bodyParts.length > 0) {
    const main = bodyParts.join('\n\n');
    // Promote first line to H1 if it already looks like a heading; else wrap
    if (/^#\s/m.test(main)) {
      sections.push(main);
    } else {
      const titleGuess = firstHeadingOrGoal(main, userGoals);
      sections.push(`# ${titleGuess}\n\n${main}`);
    }
  } else if (userGoals.length > 0) {
    sections.push(`# ${firstHeadingOrGoal('', userGoals)}\n\n${userGoals.join('\n\n')}`);
  } else {
    throw new Error('distillFromMessages: refused — nothing left to publish after exclusion filters');
  }

  let markdown = sections.join('\n\n').trim() + '\n';

  // Size-cap: truncate and record excluded overflow
  if (markdown.length > PUBLISH_MARKDOWN_MAX_CHARS) {
    const overflow = markdown.slice(PUBLISH_MARKDOWN_MAX_CHARS);
    excluded.push({ reason: 'size-cap', excerptHash: hashExcerpt(overflow), origin: 'session' });
    markdown = markdown.slice(0, PUBLISH_MARKDOWN_MAX_CHARS);
  }

  const title = firstHeadingOrGoal(markdown, userGoals);
  const summary = buildSummary(bodyParts.length > 0 ? bodyParts : userGoals);
  const outline = extractOutline(markdown);
  const contentHash = hashMarkdownContent(markdown);
  const now = opts.now ?? Date.now();
  const draftId = opts.draftId ?? `draft_${crypto.randomUUID()}`;

  const draft = {
    id: draftId,
    status: 'draft' as const,
    runIds: opts.runIds ? [...opts.runIds] : [],
    connectionId: opts.connectionId,
    title,
    markdown,
    summary,
    outline,
    sourceBlocks: [] as string[],
    sourceMessages,
    excluded,
    contentHash,
    model: opts.model ?? { connectionSlug: 'deterministic', modelId: 'distill-v1' },
    createdAt: now,
    updatedAt: now,
  };

  if (sessionId !== undefined) {
    return { ...draft, sessionId };
  }
  return draft;
}

/**
 * Build the human-readable provenance YAML front-matter prepended to published markdown.
 * Attribute names on the SiYuan side use craft-* (engine allowlist); YAML uses nested craft: keys.
 */
export function buildProvenanceYaml(provenance: PublicationProvenance): string {
  const lines = [
    '---',
    'craft:',
  ];
  if (provenance.source_session_id) {
    lines.push(`  source_session_id: ${provenance.source_session_id}`);
  }
  lines.push(
    `  source_run_ids: [${provenance.source_run_ids.map((id) => JSON.stringify(id)).join(', ')}]`,
    `  published_at: ${provenance.published_at}`,
    `  generated_by: { provider: ${JSON.stringify(provenance.generated_by.provider)}, model: ${JSON.stringify(provenance.generated_by.model)} }`,
    `  source_blocks: [${provenance.source_blocks.map((b) => JSON.stringify(b)).join(', ')}]`,
    `  content_hash: ${provenance.content_hash}`,
    '---',
    '',
  );
  return lines.join('\n');
}

/** Attribute keys written via setAttribute (must match ^(craft-|knowledge-)). */
export const PROVENANCE_ATTR = {
  sourceSessionId: 'craft-source-session-id',
  sourceRunIds: 'craft-source-run-ids',
  publishedAt: 'craft-published-at',
  contentHash: 'craft-content-hash',
} as const;

export function buildBodyWithProvenance(markdown: string, provenance: PublicationProvenance): string {
  // Avoid double-prepending if caller already included a craft: front-matter block.
  if (/^---\ncraft:\n/m.test(markdown)) return markdown;
  return buildProvenanceYaml(provenance) + markdown.replace(/^\uFEFF?/, '');
}
