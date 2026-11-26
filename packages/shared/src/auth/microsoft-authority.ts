/**
 * Microsoft identity platform authority and the rules for a source's own Entra app
 * (`api.microsoftOAuthClientId` / `api.microsoftTenantId`).
 *
 * Pure (no Node APIs), so the config validators share these rules with the OAuth flow.
 */

export const MICROSOFT_LOGIN_ORIGIN = 'https://login.microsoftonline.com';

/** "common" signs in personal Microsoft accounts and work/school accounts. */
export const MICROSOFT_DEFAULT_TENANT = 'common';

/**
 * A directory (tenant) ID, a verified domain (contoso.onmicrosoft.com, contoso.com),
 * or common / organizations / consumers. The tenant becomes a path segment of the
 * authority URL, so only letters, digits, dots and hyphens are accepted.
 */
const MICROSOFT_TENANT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/;

/** An Entra Application (client) ID is a GUID. */
const MICROSOFT_CLIENT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const MICROSOFT_TENANT_RULE =
  'Use the directory (tenant) ID, a domain such as contoso.onmicrosoft.com, or common, organizations or consumers.';

export const MICROSOFT_CLIENT_ID_RULE =
  'Use the Application (client) ID of the app registration: a GUID such as 00000000-0000-0000-0000-000000000000.';

export function isValidMicrosoftTenant(tenant: string): boolean {
  return MICROSOFT_TENANT_PATTERN.test(tenant);
}

export function isValidMicrosoftClientId(clientId: string): boolean {
  return MICROSOFT_CLIENT_ID_PATTERN.test(clientId);
}

export interface MicrosoftAuthority {
  tenant: string;
  authorizeUrl: string;
  tokenUrl: string;
}

/**
 * Authorize and token endpoints for a tenant (default "common"). A single-tenant app
 * registration must use its own tenant: Entra refuses /common for it (AADSTS50194).
 */
export function microsoftAuthority(tenantId?: string): MicrosoftAuthority {
  const tenant = tenantId?.trim() || MICROSOFT_DEFAULT_TENANT;
  if (!isValidMicrosoftTenant(tenant)) {
    throw new Error(`Invalid Microsoft tenant '${tenant}'. ${MICROSOFT_TENANT_RULE}`);
  }
  const base = `${MICROSOFT_LOGIN_ORIGIN}/${tenant}/oauth2/v2.0`;
  return { tenant, authorizeUrl: `${base}/authorize`, tokenUrl: `${base}/token` };
}
