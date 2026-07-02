import type { SharedEntityMeta } from '../records/types.ts';

export const ARTIST_COMMUNITY_CONTEXT_SLUG = 'artist-community';

export type CommunitySegment = 'vip' | 'local' | 'buyers' | 'street-team' | 'general';
export type ConsentStatus = 'unknown' | 'opted-in' | 'transactional-only' | 'unsubscribed' | 'bounced';
export type ContactSource = 'manual' | 'csv-import' | 'signup-form' | 'esp-sync' | 'gmail-import';

export interface CommunityContactRecord extends SharedEntityMeta {
  email?: string;
  emailHash: string;
  espExternalId?: string;
  name?: string;
  city?: string;
  region?: string;
  country?: string;
  source: ContactSource;
  consentStatus: ConsentStatus;
  consentEvidence?: {
    source: string;
    capturedAt?: string;
    ipHash?: string;
    formId?: string;
  };
  tags: string[];
  segments: string[];
  notes?: string;
  lastContactedAt?: string;
}

export interface CommunitySuppressionRecord extends SharedEntityMeta {
  emailHash: string;
  reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual-block';
  source: 'manual' | 'gmail' | 'esp' | 'import';
  effectiveAt: string;
}

export type EmailJobStatus =
  | 'draft'
  | 'needs-provider'
  | 'needs-approval'
  | 'needs-owner-approval'
  | 'approved'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface CommunityEmailJobRecord extends SharedEntityMeta {
  title: string;
  purpose: 'announcement' | 'newsletter' | 'personal-outreach' | 'transactional';
  audience: {
    segmentIds: string[];
    includedConsentStatuses: ConsentStatus[];
    estimatedRecipients: number;
    excludedSuppressed: number;
    excludedUnknownConsent: number;
    frozenMemberHashes?: string[];
  };
  content: {
    subject: string;
    previewText?: string;
    bodyMarkdown: string;
  };
  compliance: {
    requiresUnsubscribe: boolean;
    physicalAddressIncluded: boolean;
    senderIdentityConfirmed: boolean;
    suppressionCheckedAt?: string;
  };
  cadence: {
    lastBroadcastAtAtDraft?: string;
    minDaysBetweenBroadcasts: number;
    fatigued: boolean;
    overriddenBy?: { machineId: string; at: string };
  };
  idempotencyKey: string;
  transport: {
    provider: 'gmail' | 'esp' | 'manual-export';
    providerAccountId?: string;
    providerCampaignId?: string;
  };
  approval?: {
    approvedByMachineId?: string;
    approvedAt?: string;
  };
  send?: {
    scheduledFor?: string;
    startedAt?: string;
    completedAt?: string;
    sentCount?: number;
    failedCount?: number;
  };
  status: EmailJobStatus;
}

export interface CommunityImportRecord extends SharedEntityMeta {
  filename?: string;
  consentAttestation: {
    assertedBy: string;
    assertedAt: string;
    basis: 'existing-list-opt-in' | 'signup-form' | 'unknown';
  };
  stats: {
    created: number;
    updated: number;
    skippedSuppressed: number;
    invalidRows: number;
  };
}

export interface CommunityIndex {
  version: 1;
  generatedAt: string;
  totalContacts: number;
  suppressedCount: number;
  emailJobCount: number;
  contacts: Array<{
    id: string;
    name?: string;
    email?: string;
    emailHash: string;
    city?: string;
    segments: string[];
    tags: string[];
    consentStatus: ConsentStatus;
    source: ContactSource;
    updatedAt: string;
  }>;
  emailJobs: Array<{
    id: string;
    title: string;
    status: EmailJobStatus;
    purpose: CommunityEmailJobRecord['purpose'];
    estimatedRecipients: number;
    updatedAt: string;
  }>;
}

export interface CommunityState {
  contacts: CommunityContactRecord[];
  emailJobs: CommunityEmailJobRecord[];
  suppressions: CommunitySuppressionRecord[];
  index: CommunityIndex;
  migrated: boolean;
}

export interface UpsertCommunityContactInput {
  id?: string;
  name?: string;
  email: string;
  segment?: CommunitySegment;
  source?: ContactSource;
  city?: string;
  notes?: string;
  tags?: string[];
  consentStatus?: ConsentStatus;
}

export interface ImportCommunityCsvInput {
  csv: string;
  filename?: string;
  assertedBy: string;
  basis: CommunityImportRecord['consentAttestation']['basis'];
}

export interface CreateCommunityEmailJobInput {
  title: string;
  segmentIds: string[];
  purpose?: CommunityEmailJobRecord['purpose'];
  subject?: string;
  bodyMarkdown?: string;
  transportProvider?: CommunityEmailJobRecord['transport']['provider'];
}
