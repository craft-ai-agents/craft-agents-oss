import type {
  CredentialMigrationBackend,
  CredentialMigrationRecord,
  CredentialMigrationSnapshot,
} from './backends/types.ts';
import { encodeCredentialEnvelope } from './envelope.ts';
import {
  credentialKindForType,
  CredentialManager,
  getCredentialManager,
} from './manager.ts';
import type { CredentialId } from './types.ts';

export type CredentialMigrationEntryStatus = 'ready' | 'already-envelope' | 'skipped';

export interface CredentialMigrationEntry {
  readonly id: CredentialId;
  readonly status: CredentialMigrationEntryStatus;
}

export interface CredentialMigrationPreview {
  readonly entries: readonly CredentialMigrationEntry[];
  readonly ready: number;
  readonly alreadyEnvelope: number;
  readonly skipped: number;
}

export interface CredentialMigrationApplyResult extends CredentialMigrationPreview {
  readonly applied: number;
  readonly snapshot: CredentialMigrationSnapshot | null;
}

interface EvaluatedMigration {
  readonly preview: CredentialMigrationPreview;
  readonly replacements: readonly CredentialMigrationRecord[];
}

function cloneCredentialId(id: CredentialId): CredentialId {
  return {
    type: id.type,
    connectionSlug: id.connectionSlug,
    workspaceId: id.workspaceId,
    sourceId: id.sourceId,
    name: id.name,
    hostId: id.hostId,
  };
}

async function evaluateMigration(manager: CredentialManager): Promise<EvaluatedMigration> {
  const entries: CredentialMigrationEntry[] = [];
  const replacements: CredentialMigrationRecord[] = [];
  let ready = 0;
  let alreadyEnvelope = 0;
  let skipped = 0;

  for (const id of await manager.list()) {
    const classified = await manager.inspect(id);
    const safeId = cloneCredentialId(id);
    if (!classified) {
      entries.push({ id: safeId, status: 'skipped' });
      skipped += 1;
      continue;
    }
    if (classified.encoding === 'envelope-v1') {
      entries.push({ id: safeId, status: 'already-envelope' });
      alreadyEnvelope += 1;
      continue;
    }
    try {
      replacements.push({
        id: safeId,
        credential: {
          value: encodeCredentialEnvelope({
            kind: credentialKindForType(id.type),
            payload: classified.credential,
          }),
        },
      });
      entries.push({ id: safeId, status: 'ready' });
      ready += 1;
    } catch {
      entries.push({ id: safeId, status: 'skipped' });
      skipped += 1;
    }
  }

  return {
    preview: { entries, ready, alreadyEnvelope, skipped },
    replacements,
  };
}

async function migrationBackend(manager: CredentialManager): Promise<CredentialMigrationBackend> {
  return manager.getMigrationBackend();
}

export async function previewCredentialMigration(
  manager: CredentialManager = getCredentialManager(),
): Promise<CredentialMigrationPreview> {
  await migrationBackend(manager);
  return (await evaluateMigration(manager)).preview;
}

export async function applyCredentialMigration(
  manager: CredentialManager = getCredentialManager(),
): Promise<CredentialMigrationApplyResult> {
  const backend = await migrationBackend(manager);
  const evaluated = await evaluateMigration(manager);
  if (evaluated.replacements.length === 0) {
    return { ...evaluated.preview, applied: 0, snapshot: null };
  }
  const snapshot = await backend.createMigrationSnapshot();
  await backend.applyMigration(snapshot, evaluated.replacements);
  return {
    ...evaluated.preview,
    applied: evaluated.replacements.length,
    snapshot,
  };
}

export async function rollbackCredentialMigration(
  snapshot: CredentialMigrationSnapshot,
  manager: CredentialManager = getCredentialManager(),
): Promise<void> {
  await (await migrationBackend(manager)).rollbackMigration(snapshot);
}
