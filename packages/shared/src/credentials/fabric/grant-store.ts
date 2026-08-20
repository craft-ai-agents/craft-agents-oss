import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AccessGrant, ConsumerIdentity } from './broker.ts';

const SECRET_FIELD = /"value"|"payload"|"secret"|"refreshToken"|"clientSecret"|"idToken"|"awsSessionToken"/;

export interface AccessGrantStore {
  getById(id: string): Promise<AccessGrant | undefined>;
  list(): Promise<readonly AccessGrant[]>;
  put(grant: AccessGrant): Promise<void>;
  revoke(id: string): Promise<void>;
  listForConsumer(consumer: ConsumerIdentity): Promise<readonly AccessGrant[]>;
}

export class MemoryAccessGrantStore implements AccessGrantStore {
  private readonly rows = new Map<string, AccessGrant>();

  async getById(id: string): Promise<AccessGrant | undefined> {
    return this.rows.get(id);
  }

  async list(): Promise<readonly AccessGrant[]> {
    return [...this.rows.values()];
  }

  async put(grant: AccessGrant): Promise<void> {
    this.rows.set(grant.id, grant);
  }

  async revoke(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, status: 'revoked' });
  }

  async listForConsumer(consumer: ConsumerIdentity): Promise<readonly AccessGrant[]> {
    return [...this.rows.values()].filter(
      (grant) => grant.workspaceId === consumer.workspaceId && grant.consumerId === consumer.id,
    );
  }
}

interface GrantFile {
  readonly version: 1;
  readonly grants: AccessGrant[];
}

function assertMetadataOnly(value: unknown): void {
  const text = JSON.stringify(value);
  if (SECRET_FIELD.test(text)) {
    throw new Error('grant store rejected secret field');
  }
}

export class JsonAccessGrantStore implements AccessGrantStore {
  private loaded: AccessGrant[] | undefined;

  constructor(private readonly path: string) {}

  async getById(id: string): Promise<AccessGrant | undefined> {
    return this.load().find((row) => row.id === id);
  }

  async list(): Promise<readonly AccessGrant[]> {
    return this.load();
  }

  async put(grant: AccessGrant): Promise<void> {
    const rows = [...this.load()];
    const index = rows.findIndex((row) => row.id === grant.id);
    if (index >= 0) rows[index] = grant;
    else rows.push(grant);
    this.persist(rows);
  }

  async revoke(id: string): Promise<void> {
    this.persist(this.load().map((row) => (
      row.id === id ? { ...row, status: 'revoked' as const } : row
    )));
  }

  async listForConsumer(consumer: ConsumerIdentity): Promise<readonly AccessGrant[]> {
    return this.load().filter(
      (grant) => grant.workspaceId === consumer.workspaceId && grant.consumerId === consumer.id,
    );
  }

  private load(): AccessGrant[] {
    if (this.loaded) return this.loaded;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as GrantFile;
      assertMetadataOnly(parsed);
      this.loaded = Array.isArray(parsed.grants) ? parsed.grants : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = [];
      } else {
        throw error;
      }
    }
    return this.loaded;
  }

  private persist(rows: AccessGrant[]): void {
    assertMetadataOnly(rows);
    const body: GrantFile = { version: 1, grants: rows };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
    this.loaded = rows;
  }
}
