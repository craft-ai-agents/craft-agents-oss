import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContextDoc, upsertContextDoc } from '../workspace-context/index.ts';
import {
  createCommunityEmailJob,
  importCommunityCsv,
  loadCommunityState,
  suppressCommunityContact,
  upsertCommunityContact,
} from './storage.ts';
import { ARTIST_COMMUNITY_CONTEXT_SLUG } from './types.ts';

const roots: string[] = [];
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'runner-community-'));
  roots.push(root);
  process.env.CRAFT_CONFIG_DIR = join(root, 'private');
  return root;
}

function jsonFiles(root: string, relativeDir: string): string[] {
  const dir = join(root, relativeDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
});

describe('community record storage', () => {
  test('migrates legacy artist-community context into records and generated summary', () => {
    const root = tempRoot();
    upsertContextDoc(root, {
      slug: ARTIST_COMMUNITY_CONTEXT_SLUG,
      metadata: { name: 'Artist Community', routing: { mode: 'broadcast' }, enabled: true },
      body: [
        '```json',
        JSON.stringify({
          version: 1,
          contacts: [{ id: 'fan-old', name: 'Legacy Fan', email: 'Fan@Example.com', segment: 'vip', city: 'LA' }],
          emailJobs: [{ id: 'job-old', title: 'Legacy blast', audience: 'vip', status: 'needs-gmail' }],
        }),
        '```',
      ].join('\n'),
    });

    const state = loadCommunityState(root, 'machine_a');

    expect(state.migrated).toBe(true);
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]?.email).toBe('fan@example.com');
    expect(state.contacts[0]?.segments).toContain('vip');
    expect(state.emailJobs[0]?.status).toBe('needs-provider');
    expect(jsonFiles(root, 'records/community/contacts')).toHaveLength(1);
    expect(jsonFiles(root, 'records/community/email-jobs')).toHaveLength(1);
    expect(loadContextDoc(root, ARTIST_COMMUNITY_CONTEXT_SLUG)?.body).toContain('"version": 2');
  });

  test('contact edits update one contact record and regenerate index plus summary', () => {
    const root = tempRoot();

    upsertCommunityContact(root, 'machine_a', {
      name: 'Alex',
      email: 'alex@example.com',
      segment: 'general',
      consentStatus: 'unknown',
    });
    upsertCommunityContact(root, 'machine_a', {
      name: 'Alex Updated',
      email: ' ALEX@example.com ',
      segment: 'vip',
      consentStatus: 'opted-in',
    });

    const contactFiles = jsonFiles(root, 'records/community/contacts');
    const state = loadCommunityState(root, 'machine_a');
    const index = JSON.parse(readFileSync(join(root, 'records/community/index.json'), 'utf-8')) as { totalContacts: number };

    expect(contactFiles).toHaveLength(1);
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]?.name).toBe('Alex Updated');
    expect(state.contacts[0]?.segments).toEqual(expect.arrayContaining(['general', 'vip']));
    expect(index.totalContacts).toBe(1);
    expect(loadContextDoc(root, ARTIST_COMMUNITY_CONTEXT_SLUG)?.body).toContain('"totalContacts": 1');
  });

  test('loading community state does not overwrite a non-generated manual context doc', () => {
    const root = tempRoot();
    upsertContextDoc(root, {
      slug: ARTIST_COMMUNITY_CONTEXT_SLUG,
      metadata: { name: 'Artist Community', routing: { mode: 'broadcast' }, enabled: true },
      body: 'Manual notes that do not use the legacy v1 JSON shape.',
    });

    const state = loadCommunityState(root, 'machine_a');

    expect(state.migrated).toBe(false);
    expect(loadContextDoc(root, ARTIST_COMMUNITY_CONTEXT_SLUG)?.body).toBe('Manual notes that do not use the legacy v1 JSON shape.');
    expect(JSON.parse(readFileSync(join(root, 'records/community/index.json'), 'utf-8'))).toMatchObject({ totalContacts: 0 });
  });

  test('repeated CSV import upserts by email hash without duplicate contacts', () => {
    const root = tempRoot();
    const csv = 'email,name,segment,tags\nfan@example.com,Fan One,vip,"a;b"\nFan@Example.com,Fan Again,buyers,c\n';

    const first = importCommunityCsv(root, 'machine_a', {
      csv,
      filename: 'fans.csv',
      assertedBy: 'machine_a',
      basis: 'existing-list-opt-in',
    });
    const second = importCommunityCsv(root, 'machine_a', {
      csv,
      filename: 'fans.csv',
      assertedBy: 'machine_a',
      basis: 'existing-list-opt-in',
    });
    const state = loadCommunityState(root, 'machine_a');

    expect(first.stats.created).toBe(1);
    expect(first.stats.updated).toBe(1);
    expect(second.stats.created).toBe(0);
    expect(second.stats.updated).toBe(2);
    expect(state.contacts).toHaveLength(1);
    expect(jsonFiles(root, 'records/community/contacts')).toHaveLength(1);
  });

  test('unknown-basis import does not downgrade an existing opted-in contact', () => {
    const root = tempRoot();
    upsertCommunityContact(root, 'machine_a', {
      name: 'Opted Fan',
      email: 'fan@example.com',
      segment: 'general',
      consentStatus: 'opted-in',
    });

    importCommunityCsv(root, 'machine_a', {
      csv: 'email,name,segment\nFAN@example.com,Opted Fan,general\n',
      filename: 'unknown.csv',
      assertedBy: 'machine_a',
      basis: 'unknown',
    });

    const state = loadCommunityState(root, 'machine_a');
    expect(state.contacts).toHaveLength(1);
    expect(state.contacts[0]?.consentStatus).toBe('opted-in');
  });

  test('suppressed contacts are excluded from email job audiences', () => {
    const root = tempRoot();
    upsertCommunityContact(root, 'machine_a', {
      name: 'Ready Fan',
      email: 'ready@example.com',
      segment: 'vip',
      consentStatus: 'opted-in',
    });
    upsertCommunityContact(root, 'machine_a', {
      name: 'Blocked Fan',
      email: 'blocked@example.com',
      segment: 'vip',
      consentStatus: 'opted-in',
    });
    suppressCommunityContact(root, 'machine_a', 'blocked@example.com');

    const job = createCommunityEmailJob(root, 'machine_a', {
      title: 'VIP send',
      segmentIds: ['vip'],
      purpose: 'newsletter',
    });

    expect(job.audience.estimatedRecipients).toBe(1);
    expect(job.audience.excludedSuppressed).toBe(1);
  });

  test('unknown consent is excluded from newsletter audiences', () => {
    const root = tempRoot();
    upsertCommunityContact(root, 'machine_a', {
      name: 'Unknown Fan',
      email: 'unknown@example.com',
      segment: 'general',
      consentStatus: 'unknown',
    });

    const job = createCommunityEmailJob(root, 'machine_a', {
      title: 'Newsletter',
      segmentIds: ['general'],
      purpose: 'newsletter',
    });

    expect(job.audience.estimatedRecipients).toBe(0);
    expect(job.audience.excludedUnknownConsent).toBe(1);
    expect(job.audience.includedConsentStatuses).toEqual(['opted-in']);
  });
});
