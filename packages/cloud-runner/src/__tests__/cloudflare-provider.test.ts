/**
 * Live conformance leg for CloudflareComputerProvider.
 *
 * Gated on CLOUD_RUNS_GATEWAY_URL + CLOUD_RUNS_TOKEN (nightly CI job,
 * per PRD §G2.7). Without env the test is skipped entirely.
 */
import { describe, expect, test } from 'bun:test';
import { conformanceSuite } from '../conformance.ts';
import { CloudflareComputerProvider } from '../cloudflare-provider.ts';

const baseUrl = process.env.CLOUD_RUNS_GATEWAY_URL;
const token = process.env.CLOUD_RUNS_TOKEN;

describe('CloudflareComputerProvider conformance (live)', () => {
  test.skipIf(!baseUrl || !token)('satisfies the CloudRunProvider contract against the deployed gateway', async () => {
    const results = await conformanceSuite(() => new CloudflareComputerProvider({ baseUrl: baseUrl!, token: token! }), undefined);
    const failures = results.filter((r) => !r.ok);
    expect(failures.map((f) => `${f.name}: ${f.error ?? ''}`)).toEqual([]);
  }, 600_000);
});
