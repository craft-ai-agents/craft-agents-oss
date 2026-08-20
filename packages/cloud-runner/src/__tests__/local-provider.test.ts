/**
 * Conformance run against LocalSubprocessProvider.
 *
 * This is the always-on leg of the matrix (PRD G1.4); cloud providers
 * add their own test files gated behind env flags and reuse
 * conformanceSuite unchanged.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceSuite } from '../conformance.ts';
import { LocalSubprocessProvider } from '../local-provider.ts';

describe('LocalSubprocessProvider conformance', () => {
  test('satisfies the CloudRunProvider contract', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'cloud-runner-test-'));
    try {
      const results = await conformanceSuite(() => new LocalSubprocessProvider({ baseDir }));
      const failures = results.filter((r) => !r.ok);
      expect(failures.map((f) => `${f.name}: ${f.error ?? ''}`)).toEqual([]);
    } finally {
      await rm(baseDir, { recursive: true, force: true });
    }
  }, 60_000);
});
