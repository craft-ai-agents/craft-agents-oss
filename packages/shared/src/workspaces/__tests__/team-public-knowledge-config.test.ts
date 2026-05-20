import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspaceConfig } from '../storage.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace storage: team public knowledge config', () => {
  it('loads enabled team public knowledge documents with stable priority order', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-team-knowledge-config-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(
      join(workspaceRoot, 'config.json'),
      JSON.stringify({
        id: 'ws_team',
        name: 'Team Workspace',
        slug: 'team-workspace',
        teamPublicKnowledge: {
          enabled: true,
          documents: [
            {
              id: 'deploy-rules',
              title: 'Deploy Rules',
              url: 'https://example.com/deploy.md',
              priority: 20,
            },
            {
              id: 'team-slang',
              title: 'Team Slang',
              url: 'https://example.com/slang.md',
              priority: 5,
            },
          ],
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, null, 2),
      'utf-8',
    );

    const loaded = loadWorkspaceConfig(workspaceRoot);

    expect(loaded?.teamPublicKnowledge?.enabled).toBe(true);
    expect(loaded?.teamPublicKnowledge?.documents.map(doc => doc.id)).toEqual([
      'team-slang',
      'deploy-rules',
    ]);
  });
});
