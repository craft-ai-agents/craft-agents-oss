import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  getRecordCollectionDir,
  readSharedRecordBaseline,
  writeSharedRecord,
  type SharedRecord,
} from '../records/index.ts';
import {
  loadContextDoc,
  upsertContextDoc,
} from '../workspace-context/index.ts';
import type {
  CommunityContactRecord,
  CommunityEmailJobRecord,
  CommunityImportRecord,
  CommunityIndex,
  CommunitySegment,
  CommunityState,
  CommunitySuppressionRecord,
  ConsentStatus,
  ContactSource,
  CreateCommunityEmailJobInput,
  ImportCommunityCsvInput,
  UpsertCommunityContactInput,
} from './types.ts';
import { ARTIST_COMMUNITY_CONTEXT_SLUG } from './types.ts';

const CONTACTS_COLLECTION = 'community/contacts';
const EMAIL_JOBS_COLLECTION = 'community/email-jobs';
const SUPPRESSION_COLLECTION = 'community/suppression';
const IMPORTS_COLLECTION = 'community/imports';
const COMMUNITY_INDEX_FILE = 'records/community/index.json';

interface LegacyCommunityContact {
  id?: string;
  name?: string;
  email?: string;
  segment?: string;
  source?: string;
  city?: string;
  lastContacted?: string;
  notes?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyCommunityEmailJob {
  id?: string;
  title?: string;
  audience?: string;
  status?: string;
  scheduledFor?: string;
  createdAt?: string;
  updatedAt?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed || undefined;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function communityEmailHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function safeId(prefix: string, seed?: string): string {
  const base = seed
    ?.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${prefix}_${base || randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function normalizeSegment(value: string | undefined): CommunitySegment {
  if (value === 'vip' || value === 'local' || value === 'buyers' || value === 'street-team' || value === 'general') return value;
  return 'general';
}

function consentForBasis(basis: CommunityImportRecord['consentAttestation']['basis']): ConsentStatus {
  if (basis === 'unknown') return 'unknown';
  return 'opted-in';
}

function contactSource(value: string | undefined): ContactSource {
  if (value === 'csv-import' || value === 'signup-form' || value === 'esp-sync' || value === 'gmail-import') return value;
  return 'manual';
}

function readJsonRecords<T extends { id: string }>(workspaceRootPath: string, collection: string): T[] {
  const dir = getRecordCollectionDir(workspaceRootPath, collection);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as T;
        return parsed?.id ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf-8');
    renameSync(tmp, file);
  } catch (error) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw error;
  }
}

function buildCommunityIndex(
  contacts: CommunityContactRecord[],
  emailJobs: CommunityEmailJobRecord[],
  suppressions: CommunitySuppressionRecord[],
): CommunityIndex {
  return {
    version: 1,
    generatedAt: nowIso(),
    totalContacts: contacts.filter((contact) => !contact.deletedAt).length,
    suppressedCount: suppressions.filter((suppression) => !suppression.deletedAt).length,
    emailJobCount: emailJobs.filter((job) => !job.deletedAt).length,
    contacts: contacts
      .filter((contact) => !contact.deletedAt)
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
      .map((contact) => ({
        id: contact.id,
        name: contact.name,
        email: contact.email,
        emailHash: contact.emailHash,
        city: contact.city,
        segments: contact.segments,
        tags: contact.tags,
        consentStatus: contact.consentStatus,
        source: contact.source,
        updatedAt: contact.updatedAt,
      })),
    emailJobs: emailJobs
      .filter((job) => !job.deletedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((job) => ({
        id: job.id,
        title: job.title,
        status: job.status,
        purpose: job.purpose,
        estimatedRecipients: job.audience.estimatedRecipients,
        updatedAt: job.updatedAt,
      })),
  };
}

function writeCommunityIndex(workspaceRootPath: string, index: CommunityIndex): void {
  atomicWriteJson(join(workspaceRootPath, COMMUNITY_INDEX_FILE), index);
}

function generateSummaryBody(state: Omit<CommunityState, 'migrated'>): string {
  const segmentCounts = new Map<string, number>();
  for (const contact of state.contacts) {
    if (contact.deletedAt) continue;
    for (const segment of contact.segments) segmentCounts.set(segment, (segmentCounts.get(segment) ?? 0) + 1);
  }
  const recentBroadcasts = state.emailJobs
    .filter((job) => job.status === 'sent')
    .slice(0, 5)
    .map((job) => ({ id: job.id, title: job.title, completedAt: job.send?.completedAt }));
  const payload = {
    version: 2,
    summary: {
      totalContacts: state.index.totalContacts,
      segments: Array.from(segmentCounts.entries()).map(([id, count]) => ({ id, label: id, count })),
      lastBroadcastAt: recentBroadcasts[0]?.completedAt,
      suppressedCount: state.index.suppressedCount,
    },
    recentBroadcasts,
    warnings: [],
  };
  return [
    'Generated artist community summary for agents. Full fan records stay in records/community and should only be read for approved jobs.',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n');
}

function writeCommunitySummary(workspaceRootPath: string, state: Omit<CommunityState, 'migrated'>): void {
  upsertContextDoc(workspaceRootPath, {
    slug: ARTIST_COMMUNITY_CONTEXT_SLUG,
    metadata: {
      name: 'Artist Community',
      description: 'Generated summary of fan contacts, email segments, suppressions, and outreach jobs.',
      routing: { mode: 'broadcast' },
      enabled: true,
    },
    body: generateSummaryBody(state),
  });
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1];
  const firstBrace = body.indexOf('{');
  const lastBrace = body.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return body.slice(firstBrace, lastBrace + 1);
}

function parseLegacyCommunity(workspaceRootPath: string): { contacts: LegacyCommunityContact[]; emailJobs: LegacyCommunityEmailJob[] } | null {
  const doc = loadContextDoc(workspaceRootPath, ARTIST_COMMUNITY_CONTEXT_SLUG);
  const json = doc?.body ? extractJson(doc.body) : null;
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { version?: number; contacts?: LegacyCommunityContact[]; emailJobs?: LegacyCommunityEmailJob[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.contacts)) return null;
    return {
      contacts: parsed.contacts,
      emailJobs: Array.isArray(parsed.emailJobs) ? parsed.emailJobs : [],
    };
  } catch {
    return null;
  }
}

function findContactByEmailHash(contacts: CommunityContactRecord[], emailHash: string): CommunityContactRecord | undefined {
  return contacts.find((contact) => contact.emailHash === emailHash && !contact.deletedAt);
}

function upsertContactRecord(
  workspaceRootPath: string,
  machineId: string,
  input: UpsertCommunityContactInput,
  options: { now?: string; consentEvidenceSource?: string } = {},
): CommunityContactRecord {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) throw new Error('Contact email is invalid.');
  const emailHash = communityEmailHash(email);
  const existing = findContactByEmailHash(listCommunityContacts(workspaceRootPath), emailHash);
  const id = existing?.id ?? input.id ?? safeId('fan', emailHash.slice(0, 16));
  const segment = normalizeSegment(input.segment);
  const tags = Array.from(new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)));
  const previous = existing ? readSharedRecordBaseline<SharedRecord>(workspaceRootPath, CONTACTS_COLLECTION, existing.id) : null;
  const result = writeSharedRecord(workspaceRootPath, CONTACTS_COLLECTION, id, {
    email,
    emailHash,
    name: clean(input.name) ?? existing?.name,
    city: clean(input.city) ?? existing?.city,
    source: input.source ?? existing?.source ?? 'manual',
    consentStatus: input.consentStatus ?? existing?.consentStatus ?? 'unknown',
    consentEvidence: options.consentEvidenceSource
      ? { source: options.consentEvidenceSource, capturedAt: options.now ?? nowIso() }
      : existing?.consentEvidence,
    tags: Array.from(new Set([...(existing?.tags ?? []), ...tags])),
    segments: Array.from(new Set([...(existing?.segments ?? []), segment])),
    notes: clean(input.notes) ?? existing?.notes,
    lastContactedAt: existing?.lastContactedAt,
  }, {
    machineId,
    baseline: previous ?? undefined,
    now: options.now,
  });
  if (result.status === 'conflict') throw new Error(`Community contact conflict: ${result.conflict.conflictId}`);
  return result.entity as CommunityContactRecord;
}

function legacyStatus(status: string | undefined): CommunityEmailJobRecord['status'] {
  if (status === 'queued' || status === 'sent') return status;
  if (status === 'needs-gmail') return 'needs-provider';
  return 'draft';
}

export function listCommunityContacts(workspaceRootPath: string): CommunityContactRecord[] {
  return readJsonRecords<CommunityContactRecord>(workspaceRootPath, CONTACTS_COLLECTION);
}

export function listCommunityEmailJobs(workspaceRootPath: string): CommunityEmailJobRecord[] {
  return readJsonRecords<CommunityEmailJobRecord>(workspaceRootPath, EMAIL_JOBS_COLLECTION);
}

export function listCommunitySuppressions(workspaceRootPath: string): CommunitySuppressionRecord[] {
  return readJsonRecords<CommunitySuppressionRecord>(workspaceRootPath, SUPPRESSION_COLLECTION);
}

export function loadCommunityState(workspaceRootPath: string, machineId: string): CommunityState {
  const migrated = migrateLegacyCommunityIfNeeded(workspaceRootPath, machineId);
  const contacts = listCommunityContacts(workspaceRootPath);
  const emailJobs = listCommunityEmailJobs(workspaceRootPath);
  const suppressions = listCommunitySuppressions(workspaceRootPath);
  const index = buildCommunityIndex(contacts, emailJobs, suppressions);
  writeCommunityIndex(workspaceRootPath, index);
  writeCommunitySummary(workspaceRootPath, { contacts, emailJobs, suppressions, index });
  return { contacts, emailJobs, suppressions, index, migrated };
}

export function migrateLegacyCommunityIfNeeded(workspaceRootPath: string, machineId: string): boolean {
  if (listCommunityContacts(workspaceRootPath).length > 0 || listCommunityEmailJobs(workspaceRootPath).length > 0) return false;
  const legacy = parseLegacyCommunity(workspaceRootPath);
  if (!legacy) return false;
  for (const contact of legacy.contacts) {
    if (!contact.email) continue;
    upsertContactRecord(workspaceRootPath, machineId, {
      id: contact.id ? safeId('fan', contact.id) : undefined,
      name: contact.name,
      email: contact.email,
      segment: normalizeSegment(contact.segment),
      source: contactSource(contact.source),
      city: contact.city,
      notes: contact.notes,
      tags: contact.tags,
      consentStatus: 'unknown',
    }, { now: contact.updatedAt, consentEvidenceSource: 'legacy-artist-community' });
  }
  for (const job of legacy.emailJobs) {
    createCommunityEmailJob(workspaceRootPath, machineId, {
      title: job.title ?? 'Email job',
      segmentIds: [job.audience ?? 'general'],
      purpose: 'newsletter',
      subject: job.title ?? 'Fan email',
      bodyMarkdown: '',
      transportProvider: 'gmail',
    }, { id: job.id ? safeId('email', job.id) : undefined, now: job.updatedAt, status: legacyStatus(job.status) });
  }
  return true;
}

export function upsertCommunityContact(
  workspaceRootPath: string,
  machineId: string,
  input: UpsertCommunityContactInput,
): CommunityContactRecord {
  const contact = upsertContactRecord(workspaceRootPath, machineId, input);
  loadCommunityState(workspaceRootPath, machineId);
  return contact;
}

function parseCsvRows(csv: string): Array<Record<string, string>> {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]!).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index]?.trim() ?? '';
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

export function importCommunityCsv(
  workspaceRootPath: string,
  machineId: string,
  input: ImportCommunityCsvInput,
): CommunityImportRecord {
  const rows = parseCsvRows(input.csv);
  let created = 0;
  let updated = 0;
  let skippedSuppressed = 0;
  let invalidRows = 0;
  const suppressions = new Set(listCommunitySuppressions(workspaceRootPath).map((suppression) => suppression.emailHash));
  for (const row of rows) {
    const email = row.email || row['email address'];
    if (!email || !email.includes('@')) {
      invalidRows += 1;
      continue;
    }
    const emailHash = communityEmailHash(email);
    if (suppressions.has(emailHash)) {
      skippedSuppressed += 1;
      continue;
    }
    const existed = Boolean(findContactByEmailHash(listCommunityContacts(workspaceRootPath), emailHash));
    upsertContactRecord(workspaceRootPath, machineId, {
      name: row.name || row.fullname || row['full name'],
      email,
      segment: normalizeSegment(row.segment),
      source: 'csv-import',
      city: row.city,
      notes: row.notes,
      tags: (row.tags ?? '').split(/[;,]/).map((tag) => tag.trim()).filter(Boolean),
      consentStatus: consentForBasis(input.basis),
    }, { consentEvidenceSource: input.basis });
    if (existed) updated += 1;
    else created += 1;
  }
  const importId = safeId('import', randomUUID().replace(/-/g, '').slice(0, 16));
  const result = writeSharedRecord(workspaceRootPath, IMPORTS_COLLECTION, importId, {
    filename: input.filename,
    consentAttestation: {
      assertedBy: input.assertedBy,
      assertedAt: nowIso(),
      basis: input.basis,
    },
    stats: { created, updated, skippedSuppressed, invalidRows },
  }, { machineId });
  if (result.status === 'conflict') throw new Error(`Community import conflict: ${result.conflict.conflictId}`);
  loadCommunityState(workspaceRootPath, machineId);
  return result.entity as CommunityImportRecord;
}

export function suppressCommunityContact(
  workspaceRootPath: string,
  machineId: string,
  email: string,
  reason: CommunitySuppressionRecord['reason'] = 'manual-block',
): CommunitySuppressionRecord {
  const emailHash = communityEmailHash(email);
  const result = writeSharedRecord(workspaceRootPath, SUPPRESSION_COLLECTION, emailHash, {
    emailHash,
    reason,
    source: 'manual',
    effectiveAt: nowIso(),
  }, { machineId });
  if (result.status === 'conflict') throw new Error(`Suppression conflict: ${result.conflict.conflictId}`);
  loadCommunityState(workspaceRootPath, machineId);
  return result.entity as CommunitySuppressionRecord;
}

function audienceForSegments(
  contacts: CommunityContactRecord[],
  suppressions: CommunitySuppressionRecord[],
  segmentIds: string[],
  purpose: CommunityEmailJobRecord['purpose'],
): CommunityEmailJobRecord['audience'] {
  const suppressed = new Set(suppressions.map((suppression) => suppression.emailHash));
  const includedConsentStatuses: ConsentStatus[] = purpose === 'personal-outreach'
    ? ['opted-in', 'unknown', 'transactional-only']
    : ['opted-in'];
  let excludedSuppressed = 0;
  let excludedUnknownConsent = 0;
  const members = contacts.filter((contact) => {
    if (contact.deletedAt) return false;
    if (segmentIds.length && !segmentIds.some((segment) => contact.segments.includes(segment))) return false;
    if (suppressed.has(contact.emailHash)) {
      excludedSuppressed += 1;
      return false;
    }
    if (!includedConsentStatuses.includes(contact.consentStatus)) {
      if (contact.consentStatus === 'unknown') excludedUnknownConsent += 1;
      return false;
    }
    return true;
  });
  return {
    segmentIds,
    includedConsentStatuses,
    estimatedRecipients: members.length,
    excludedSuppressed,
    excludedUnknownConsent,
    frozenMemberHashes: members.map((contact) => contact.emailHash),
  };
}

export function createCommunityEmailJob(
  workspaceRootPath: string,
  machineId: string,
  input: CreateCommunityEmailJobInput,
  options: { id?: string; now?: string; status?: CommunityEmailJobRecord['status'] } = {},
): CommunityEmailJobRecord {
  const contacts = listCommunityContacts(workspaceRootPath);
  const suppressions = listCommunitySuppressions(workspaceRootPath);
  const purpose = input.purpose ?? 'newsletter';
  const audience = audienceForSegments(contacts, suppressions, input.segmentIds, purpose);
  const id = options.id ?? safeId('email', randomUUID().replace(/-/g, '').slice(0, 16));
  const result = writeSharedRecord(workspaceRootPath, EMAIL_JOBS_COLLECTION, id, {
    title: input.title.trim(),
    purpose,
    audience,
    content: {
      subject: input.subject ?? input.title.trim(),
      bodyMarkdown: input.bodyMarkdown ?? '',
    },
    compliance: {
      requiresUnsubscribe: purpose === 'announcement' || purpose === 'newsletter',
      physicalAddressIncluded: false,
      senderIdentityConfirmed: false,
      suppressionCheckedAt: nowIso(),
    },
    cadence: {
      minDaysBetweenBroadcasts: 7,
      fatigued: false,
    },
    idempotencyKey: `community-email-${id}`,
    transport: { provider: input.transportProvider ?? 'gmail' },
    status: options.status ?? 'draft',
  }, { machineId, now: options.now });
  if (result.status === 'conflict') throw new Error(`Community email job conflict: ${result.conflict.conflictId}`);
  loadCommunityState(workspaceRootPath, machineId);
  return result.entity as CommunityEmailJobRecord;
}
