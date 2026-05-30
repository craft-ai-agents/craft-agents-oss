import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = join(import.meta.dir, 'bin', 'printify.mjs');

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
    stdout: result.stdout ? JSON.parse(result.stdout) : null,
    stderr: result.stderr,
  };
}

describe('printify cli wrapper', () => {
  test('reports missing upstream binary clearly', () => {
    const result = run(['shops-json', '--agent']);

    expect(result.status).toBe(127);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.error).toContain('printify-pp-cli binary not found');
    expect(JSON.stringify(result.stdout)).not.toContain('PRINTIFY_API_TOKEN=');
  });

  test('write-like product create is approval-gated before binary resolution', () => {
    const result = run([
      'shops',
      'products-json',
      'create-anew-product',
      '123',
      '--title',
      'Smoke',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.approveCommand).toContain('--confirm-runner');
  });

  test('approval packet redacts token-like command args', () => {
    const result = run([
      'products-json',
      'create-anew-product',
      '--api-key',
      'secret-value',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.command).not.toContain('secret-value');
    expect(result.stdout.approveCommand).not.toContain('secret-value');
  });

  test('dry-run write-like upload is allowed to reach binary resolution', () => {
    const result = run(['uploads', 'an-image', '--body-json', '{}', '--dry-run', '--agent']);

    expect(result.status).toBe(127);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.error).toContain('printify-pp-cli binary not found');
  });
});
