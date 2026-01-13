/**
 * Tests for electron-manifest.ts
 *
 * Run with: bun test packages/shared/src/version/__tests__/electron-manifest.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { isNewerVersion } from '../electron-manifest';

describe('isNewerVersion', () => {
  describe('standard versions', () => {
    test('returns true when latest is newer (major)', () => {
      expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
    });

    test('returns true when latest is newer (minor)', () => {
      expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
    });

    test('returns true when latest is newer (patch)', () => {
      expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
    });

    test('returns false when current is newer', () => {
      expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
    });

    test('returns false when versions are equal', () => {
      expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    });

    test('handles real version numbers', () => {
      expect(isNewerVersion('0.2.7', '0.2.8')).toBe(true);
      expect(isNewerVersion('0.2.8', '0.2.7')).toBe(false);
    });
  });

  describe('version edge cases', () => {
    test('handles versions without patch (x.y)', () => {
      expect(isNewerVersion('1.0', '1.1')).toBe(true);
      expect(isNewerVersion('1.1', '1.0')).toBe(false);
    });

    test('handles versions with just major (x)', () => {
      expect(isNewerVersion('1', '2')).toBe(true);
      expect(isNewerVersion('2', '1')).toBe(false);
    });

    test('handles v prefix', () => {
      expect(isNewerVersion('v1.0.0', 'v2.0.0')).toBe(true);
      expect(isNewerVersion('v1.0.0', '2.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0', 'v2.0.0')).toBe(true);
    });

    test('handles 0.x versions correctly (not treating 0 as falsy)', () => {
      expect(isNewerVersion('0.1.0', '0.2.0')).toBe(true);
      expect(isNewerVersion('0.0.1', '0.0.2')).toBe(true);
    });
  });

  describe('prerelease versions', () => {
    test('release is newer than prerelease of same version', () => {
      expect(isNewerVersion('1.0.0-alpha', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(true);
      expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(true);
    });

    test('prerelease is older than release of same version', () => {
      expect(isNewerVersion('1.0.0', '1.0.0-alpha')).toBe(false);
    });

    test('compares prerelease identifiers correctly', () => {
      expect(isNewerVersion('1.0.0-alpha', '1.0.0-beta')).toBe(true);
      expect(isNewerVersion('1.0.0-alpha.1', '1.0.0-alpha.2')).toBe(true);
      expect(isNewerVersion('1.0.0-alpha', '1.0.0-alpha.1')).toBe(true);
    });

    test('numeric prerelease identifiers are compared as numbers', () => {
      expect(isNewerVersion('1.0.0-alpha.1', '1.0.0-alpha.10')).toBe(true);
      expect(isNewerVersion('1.0.0-alpha.9', '1.0.0-alpha.10')).toBe(true);
    });

    test('numeric identifiers have lower precedence than non-numeric', () => {
      expect(isNewerVersion('1.0.0-1', '1.0.0-alpha')).toBe(true);
    });
  });

  describe('build metadata', () => {
    test('build metadata is ignored in comparison', () => {
      expect(isNewerVersion('1.0.0+build.1', '1.0.0+build.2')).toBe(false);
      expect(isNewerVersion('1.0.0+build.1', '1.0.1+build.1')).toBe(true);
    });

    test('handles combined prerelease and build metadata', () => {
      expect(isNewerVersion('1.0.0-alpha+build.1', '1.0.0-alpha+build.2')).toBe(false);
      expect(isNewerVersion('1.0.0-alpha+build.1', '1.0.0-beta+build.1')).toBe(true);
    });
  });

  describe('invalid versions', () => {
    test('returns false for unparseable current version', () => {
      expect(isNewerVersion('invalid', '1.0.0')).toBe(false);
    });

    test('returns false for unparseable latest version', () => {
      expect(isNewerVersion('1.0.0', 'invalid')).toBe(false);
    });

    test('returns false for both unparseable', () => {
      expect(isNewerVersion('invalid', 'also-invalid')).toBe(false);
    });

    test('returns false for empty strings', () => {
      expect(isNewerVersion('', '1.0.0')).toBe(false);
      expect(isNewerVersion('1.0.0', '')).toBe(false);
    });

    // This is the key test that caught the bug - string comparison would fail
    test('does not use string comparison for edge cases (would cause "0.9" > "0.10")', () => {
      // If we used string comparison, this would incorrectly return true
      // because "9" > "1" lexically. Our parser handles this correctly.
      expect(isNewerVersion('0.9.0', '0.10.0')).toBe(true);
      expect(isNewerVersion('0.10.0', '0.9.0')).toBe(false);
    });
  });
});
