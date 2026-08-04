import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { buildDarwinSandboxProfile } from './filesystem-isolation.ts';

describe('buildDarwinSandboxProfile', () => {
  it('includes session subpath write allow', () => {
    const sessionDir = '/tmp/craft-session';
    const profile = buildDarwinSandboxProfile(sessionDir);
    // Build the expectation the same way the profile does rather than
    // hardcoding a separator: on a Windows host resolve() returns a
    // drive-qualified path whose backslashes the profile escapes for SBPL.
    // On darwin — the only platform that actually runs this profile — both
    // sides reduce to the plain POSIX path.
    const expectedRoot = resolve(sessionDir).replace(/\\/g, '\\\\');
    expect(profile).toContain(`(allow file-write* (subpath "${expectedRoot}"))`);
    expect(profile).not.toContain('(deny network*)');
  });

  it('includes deny network when requested', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session', { includeNetworkDeny: true });
    expect(profile).toContain('(deny network*)');
  });
});
