import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = join(import.meta.dir, 'bin', 'shopify.mjs');

function run(args) {
  const result = spawnSync('node', [cli, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
    },
  });

  return {
    status: result.status,
    stdout: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

describe('shopify cli safety gates', () => {
  test('doctor reports missing auth without exposing secrets', () => {
    const result = run(['doctor', '--agent']);

    expect(result.status).toBe(1);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.connectionStatus).toBe('needs_auth');
    expect(JSON.stringify(result.stdout)).not.toContain('SHOPIFY_ACCESS_TOKEN=');
  });

  test('product create defaults to draft approval packet', () => {
    const result = run(['products', 'create', '--input', '{"title":"Smoke"}', '--agent']);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.operation).toBe('products.create');
    expect(result.stdout.variables.product.status).toBe('DRAFT');
    expect(result.stdout.query).toContain('ProductCreateInput');
  });

  test('inventory adjust writes approval receipt with idempotency key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runneros-shopify-test-'));
    try {
      const receipt = join(dir, 'approval.json');
      const input = JSON.stringify({
        reason: 'correction',
        name: 'available',
        referenceDocumentUri: 'runneros://test',
        changes: [
          {
            delta: 1,
            inventoryItemId: 'gid://shopify/InventoryItem/1',
            locationId: 'gid://shopify/Location/1',
          },
        ],
      });

      const result = run(['inventory', 'adjust', '--input', input, '--receipt', receipt, '--agent']);
      const written = JSON.parse(readFileSync(receipt, 'utf8'));

      expect(result.status).toBe(0);
      expect(result.stdout.requiresApproval).toBe(true);
      expect(result.stdout.operation).toBe('inventory.adjust');
      expect(result.stdout.variables.idempotencyKey).toBeTruthy();
      expect(result.stdout.approveCommand).toContain(`--idempotency-key ${result.stdout.variables.idempotencyKey}`);
      expect(result.stdout.approveCommand).not.toContain('<same-key>');
      expect(written.variables.idempotencyKey).toBe(result.stdout.variables.idempotencyKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('generic graphql gates comment-prefixed mutations', () => {
    const result = run([
      'graphql',
      '--query',
      '#graphql\n# prepare write\nmutation TestMutation { shop { name } }',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.operation).toBe('graphql.mutation');
  });
});
