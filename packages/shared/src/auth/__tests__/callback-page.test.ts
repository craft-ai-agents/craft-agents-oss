import { describe, expect, it } from 'bun:test';

import { generateSsoRelayCallbackPage } from '../callback-page.ts';

describe('generateSsoRelayCallbackPage', () => {
  it('renders success page with automatic deep link redirect and fallback link', () => {
    const deepLinkUrl = 'mdp://sso-callback?code=abc&state=xyz';

    const html = generateSsoRelayCallbackPage(deepLinkUrl);

    expect(html).toContain('Login successful');
    expect(html).toContain(`window.location.href = ${JSON.stringify(deepLinkUrl)}`);
    expect(html).toContain(`href="mdp://sso-callback?code=abc&amp;state=xyz"`);
    expect(html).toContain('Open MDP');
    expect(html).toContain('You can close this tab');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });

  it('renders error page with provider detail and no deep link behavior', () => {
    const deepLinkUrl = 'mdp://sso-callback?code=abc&state=xyz';

    const html = generateSsoRelayCallbackPage(deepLinkUrl, 'access_denied: User cancelled');

    expect(html).toContain('Login failed: access_denied: User cancelled');
    expect(html).toContain('Close this window and try again');
    expect(html).not.toContain(deepLinkUrl);
    expect(html).not.toContain('window.location.href');
    expect(html).not.toContain('Open MDP');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
  });
});
