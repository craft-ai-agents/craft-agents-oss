/**
 * These tests are the mitigation for WS0 having run on macOS only (ADR 0001).
 * They exercise the Windows-specific rules — backslashes, drive letters, ADS,
 * reserved device names, trailing dot/space — WITHOUT needing Windows, because
 * the module under test is pure string logic.
 */
import { describe, expect, it } from 'bun:test';
import {
  checkSlug,
  checkRelPath,
  checkFileSet,
  findCaseCollisions,
  hasIndexHtml,
  MAX_SLUG_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
} from './naming.ts';

describe('checkSlug', () => {
  it('accepts ordinary slugs', () => {
    for (const s of ['pottery-studio', 'a', 'a1', 'my-page-2']) {
      expect(checkSlug(s).ok).toBe(true);
    }
  });

  it('rejects shapes that would escape or collide', () => {
    for (const s of ['', '-lead', 'trail-', 'Upper', 'has space', 'has_underscore',
                     'has.dot', '../escape', 'a/b', 'a\\b', 'emoji🙂']) {
      expect(checkSlug(s).ok).toBe(false);
    }
  });

  it('rejects Windows reserved device names', () => {
    for (const s of ['con', 'nul', 'prn', 'aux', 'com1', 'lpt9']) {
      const r = checkSlug(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('reserved device name');
    }
  });

  it('bounds length for Windows MAX_PATH headroom', () => {
    expect(checkSlug('a'.repeat(MAX_SLUG_LENGTH)).ok).toBe(true);
    expect(checkSlug('a'.repeat(MAX_SLUG_LENGTH + 1)).ok).toBe(false);
  });
});

describe('checkRelPath — traversal', () => {
  it('accepts ordinary page files', () => {
    for (const p of ['index.html', 'styles.css', 'app.js', 'assets/logo.png',
                     'i18n/en.json', 'fonts/inter.woff2']) {
      const r = checkRelPath(p);
      expect(r.ok).toBe(true);
    }
  });

  it('rejects dot-segment traversal', () => {
    for (const p of ['../secret.html', 'a/../../b.html', '..\\x.html', './a.html']) {
      expect(checkRelPath(p).ok).toBe(false);
    }
  });

  it('rejects absolute paths', () => {
    expect(checkRelPath('/etc/passwd.txt').ok).toBe(false);
  });

  it('rejects percent-encoding so %2e%2e cannot round-trip into ..', () => {
    for (const p of ['%2e%2e/x.html', 'a%2fb.html', 'x%00.html']) {
      const r = checkRelPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('%');
    }
  });

  it('rejects empty segments from double slashes', () => {
    expect(checkRelPath('a//b.html').ok).toBe(false);
  });
});

describe('checkRelPath — Windows-specific (the reason this module is pure)', () => {
  it('rejects backslash separators', () => {
    const r = checkRelPath('assets\\logo.png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('ackslash');
  });

  it('rejects drive-relative paths and alternate data streams', () => {
    for (const p of ['C:foo.html', 'index.html::$DATA', 'a:b.html']) {
      const r = checkRelPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('":"');
    }
  });

  it('rejects reserved device names even with an extension', () => {
    // CON.txt still opens the console device on Windows.
    for (const p of ['con.html', 'nul.css', 'assets/com1.png', 'LPT1.json']) {
      const r = checkRelPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('reserved device name');
    }
  });

  it('rejects trailing dots and spaces that Windows silently strips', () => {
    for (const p of ['assets /logo.png', 'assets./logo.png']) {
      const r = checkRelPath(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('space or dot');
    }
  });

  it('rejects NUL and control characters', () => {
    expect(checkRelPath('a\0b.html').ok).toBe(false);
    expect(checkRelPath('a\x1fb.html').ok).toBe(false);
  });
});

describe('checkRelPath — extensions and dotfiles', () => {
  it('rejects dotfiles at any depth', () => {
    for (const p of ['.env', 'assets/.htaccess', '.git/config.json']) {
      expect(checkRelPath(p).ok).toBe(false);
    }
  });

  it('rejects extensions outside the allowlist', () => {
    for (const p of ['run.sh', 'a.exe', 'a.dll', 'a.php', 'page.html.exe']) {
      expect(checkRelPath(p).ok).toBe(false);
    }
  });

  it('rejects files with no extension', () => {
    expect(checkRelPath('Makefile').ok).toBe(false);
  });

  it('is case-insensitive about the extension itself', () => {
    expect(checkRelPath('Logo.PNG').ok).toBe(true);
  });
});

describe('findCaseCollisions', () => {
  it('flags paths differing only in case', () => {
    // Round-trips on Linux, silently overwrites on macOS/Windows.
    expect(findCaseCollisions(['Logo.png', 'logo.png'])).toHaveLength(1);
  });

  it('does not flag genuinely distinct paths or exact repeats', () => {
    expect(findCaseCollisions(['a.png', 'b.png'])).toHaveLength(0);
    expect(findCaseCollisions(['a.png', 'a.png'])).toHaveLength(0);
  });
});

describe('checkFileSet', () => {
  const f = (path: string, bytes = 10) => ({ path, bytes });

  it('accepts a normal page', () => {
    expect(checkFileSet([f('index.html'), f('styles.css'), f('assets/a.png')]).ok).toBe(true);
  });

  it('requires at least one file', () => {
    expect(checkFileSet([]).ok).toBe(false);
  });

  it('enforces per-file, total, and count limits', () => {
    expect(checkFileSet([f('index.html', MAX_FILE_BYTES + 1)]).ok).toBe(false);
    const many = Array.from({ length: MAX_FILE_COUNT + 1 }, (_, i) => f(`p${i}.html`));
    expect(checkFileSet(many).ok).toBe(false);
  });

  it('surfaces the offending path in the reason', () => {
    const r = checkFileSet([f('index.html'), f('../evil.html')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('../evil.html');
  });

  it('rejects case collisions in a set', () => {
    const r = checkFileSet([f('index.html'), f('A.png'), f('a.png')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('case');
  });
});

describe('hasIndexHtml', () => {
  it('requires an entry point', () => {
    expect(hasIndexHtml(['index.html', 'a.css'])).toBe(true);
    expect(hasIndexHtml(['home.html'])).toBe(false);
  });
});
