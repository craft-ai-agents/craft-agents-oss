import { describe, it, expect } from 'bun:test';
import { buildDarwinSandboxProfile } from './filesystem-isolation.ts';

describe('buildDarwinSandboxProfile', () => {
  it('includes session subpath write allow', () => {
    // Profile paths are POSIX-style regardless of host platform.
    const sessionDir = process.platform === 'win32' ? 'C:\\tmp\\craft-session' : '/tmp/craft-session';
    const profile = buildDarwinSandboxProfile(sessionDir);
    expect(profile).toContain(`(allow file-write* (subpath "${sessionDir.replace(/\\/g, '/')}"))`);
    expect(profile).not.toContain('(deny network*)');
  });

  it('includes deny network when requested', () => {
    const profile = buildDarwinSandboxProfile('/tmp/craft-session', { includeNetworkDeny: true });
    expect(profile).toContain('(deny network*)');
  });
});
