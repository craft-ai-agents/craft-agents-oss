/**
 * Tests for network proxy bypass rules (NO_PROXY parsing and matching).
 */
import { describe, it, expect } from 'bun:test';
import {
  normalizeProxyUrl,
  parseNoProxyRules,
  parseWindowsInternetSettings,
  parseWindowsProxyOverride,
  parseWindowsProxyServer,
  shouldBypassProxy,
} from '../network-proxy-utils';

describe('normalizeProxyUrl', () => {
  it('adds an HTTP scheme when Windows stores only host and port', () => {
    expect(normalizeProxyUrl('proxy.example:8080')).toBe('http://proxy.example:8080');
  });

  it('preserves an existing scheme and trims whitespace', () => {
    expect(normalizeProxyUrl('  https://proxy.example:8443  ')).toBe('https://proxy.example:8443');
  });
});

describe('parseWindowsProxyServer', () => {
  it('uses one proxy value for both HTTP and HTTPS', () => {
    expect(parseWindowsProxyServer('proxy.example:8080')).toEqual({
      httpProxy: 'http://proxy.example:8080',
      httpsProxy: 'http://proxy.example:8080',
    });
  });

  it('parses protocol-specific proxy values', () => {
    expect(parseWindowsProxyServer('http=http-proxy.example:8080;https=https-proxy.example:8443')).toEqual({
      httpProxy: 'http://http-proxy.example:8080',
      httpsProxy: 'http://https-proxy.example:8443',
    });
  });
});

describe('parseWindowsProxyOverride', () => {
  it('converts separators and expands the Windows local-host marker', () => {
    expect(parseWindowsProxyOverride('*.example.test;<local>')).toBe(
      '.example.test,localhost,127.0.0.1,::1',
    );
  });
});

describe('parseWindowsInternetSettings', () => {
  it('parses enabled Windows Internet Settings registry output', () => {
    const output = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       proxy.example:8080
    ProxyOverride  REG_SZ       <local>;*.example.test
`;

    expect(parseWindowsInternetSettings(output)).toEqual({
      enabled: true,
      httpProxy: 'http://proxy.example:8080',
      httpsProxy: 'http://proxy.example:8080',
      noProxy: 'localhost,127.0.0.1,::1,.example.test',
    });
  });

  it('ignores disabled Windows proxy settings', () => {
    const output = `
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ       proxy.example:8080
`;

    expect(parseWindowsInternetSettings(output)).toBeUndefined();
  });
});

describe('parseNoProxyRules', () => {
  it('returns empty array for undefined/empty input', () => {
    expect(parseNoProxyRules(undefined)).toEqual([]);
    expect(parseNoProxyRules('')).toEqual([]);
  });

  it('parses simple hostnames', () => {
    const rules = parseNoProxyRules('localhost, example.com');
    expect(rules).toEqual([
      { host: 'localhost', wildcard: false },
      { host: 'example.com', wildcard: false },
    ]);
  });

  it('parses wildcard', () => {
    const rules = parseNoProxyRules('*');
    expect(rules).toEqual([{ host: '*', wildcard: true }]);
  });

  it('strips leading dot', () => {
    const rules = parseNoProxyRules('.example.com');
    expect(rules).toEqual([{ host: 'example.com', wildcard: false }]);
  });

  it('parses host:port', () => {
    const rules = parseNoProxyRules('example.com:8080');
    expect(rules).toEqual([{ host: 'example.com', port: 8080, wildcard: false }]);
  });
});

describe('shouldBypassProxy', () => {
  it('returns false when no rules', () => {
    expect(shouldBypassProxy('https://example.com', [])).toBe(false);
  });

  it('matches exact host', () => {
    const rules = parseNoProxyRules('localhost');
    expect(shouldBypassProxy('http://localhost:3000/path', rules)).toBe(true);
    expect(shouldBypassProxy('http://example.com', rules)).toBe(false);
  });

  it('matches subdomain (suffix)', () => {
    const rules = parseNoProxyRules('example.com');
    expect(shouldBypassProxy('https://api.example.com/v1', rules)).toBe(true);
    expect(shouldBypassProxy('https://example.com', rules)).toBe(true);
    expect(shouldBypassProxy('https://notexample.com', rules)).toBe(false);
  });

  it('respects port-scoped rules', () => {
    const rules = parseNoProxyRules('example.com:8080');
    expect(shouldBypassProxy('http://example.com:8080/path', rules)).toBe(true);
    expect(shouldBypassProxy('http://example.com:9090/path', rules)).toBe(false);
  });

  it('matches implicit default ports', () => {
    const rules443 = parseNoProxyRules('example.com:443');
    // https default port is 443 — should match even without explicit port
    expect(shouldBypassProxy('https://example.com/path', rules443)).toBe(true);
    // http default port is 80 — should NOT match a :443 rule
    expect(shouldBypassProxy('http://example.com/path', rules443)).toBe(false);

    const rules80 = parseNoProxyRules('example.com:80');
    expect(shouldBypassProxy('http://example.com/path', rules80)).toBe(true);
    expect(shouldBypassProxy('https://example.com/path', rules80)).toBe(false);

    // Explicit port that differs from rule should not match
    const rules8080 = parseNoProxyRules('example.com:8080');
    expect(shouldBypassProxy('https://example.com/path', rules8080)).toBe(false);
  });

  it('wildcard bypasses everything', () => {
    const rules = parseNoProxyRules('*');
    expect(shouldBypassProxy('https://anything.example.com', rules)).toBe(true);
  });

  it('handles IPv6 literal', () => {
    const rules = parseNoProxyRules('[::1]');
    expect(shouldBypassProxy('http://[::1]:3000/path', rules)).toBe(true);
  });

  it('matches exact IP literal', () => {
    const rules = parseNoProxyRules('192.168.1.1');
    expect(shouldBypassProxy('http://192.168.1.1/', rules)).toBe(true);
    expect(shouldBypassProxy('http://10.0.0.1/', rules)).toBe(false);
  });
});
