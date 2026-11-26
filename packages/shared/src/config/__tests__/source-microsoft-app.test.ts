/**
 * The source schema checks a Microsoft source's own app registration
 * (api.microsoftOAuthClientId / api.microsoftTenantId) before a sign-in can fail on it.
 */

import { describe, expect, it } from 'bun:test';
import { validateSourceConfig } from '../validators.ts';

function outlookSource(api: Record<string, unknown>) {
  return {
    id: 'outlook-id',
    name: 'Outlook',
    slug: 'outlook',
    enabled: true,
    provider: 'microsoft',
    type: 'api',
    api: { baseUrl: 'https://graph.microsoft.com/v1.0/', authType: 'oauth', microsoftService: 'outlook', ...api },
  };
}

const CLIENT_ID = '11111111-2222-4333-8444-555555555555';

describe('source schema: Microsoft app registration', () => {
  it('accepts a client ID alone, or with a tenant ID, a domain or a well-known tenant', () => {
    expect(validateSourceConfig(outlookSource({ microsoftOAuthClientId: CLIENT_ID })).valid).toBe(true);
    for (const tenant of ['72f988bf-86f1-41af-91ab-2d7cd011db47', 'contoso.onmicrosoft.com', 'organizations']) {
      expect(validateSourceConfig(outlookSource({ microsoftOAuthClientId: CLIENT_ID, microsoftTenantId: tenant })).valid)
        .toBe(true);
    }
  });

  it('refuses a client ID that is not a GUID', () => {
    const result = validateSourceConfig(outlookSource({ microsoftOAuthClientId: 'my-app' }));

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain('api.microsoftOAuthClientId');
  });

  it('refuses a tenant that is not an ID, a domain or a well-known tenant', () => {
    const result = validateSourceConfig(outlookSource({ microsoftOAuthClientId: CLIENT_ID, microsoftTenantId: 'contoso.com/evil' }));

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.path)).toContain('api.microsoftTenantId');
  });
});
