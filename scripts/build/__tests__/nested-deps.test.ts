import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createRequire } from 'module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  copyShadowedNestedDeps,
  installedVersion,
  majorVersion,
  shadowedNestedDeps,
} from '../common';

/**
 * These cover the nested-copy step of `build-server.ts`: the build reads every
 * dependency from the repository root, which is the wrong tree for a workspace
 * package that pins a different major than the root. See OSS #1082.
 */

let root: string;

/** Write a fake installed package: package.json plus a marker file. */
function install(modulesDir: string, name: string, version: string): string {
  const dir = join(modulesDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }, null, 2));
  writeFileSync(join(dir, 'index.js'), `module.exports = ${JSON.stringify(name)};\n`);
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-nested-deps-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('majorVersion', () => {
  test('reads the major component of an installed version', () => {
    expect(majorVersion('4.3.5')).toBe('4');
    expect(majorVersion('3')).toBe('3');
    expect(majorVersion('10.0.0-rc.1')).toBe('10');
  });

  test('reads the major component of a declared range', () => {
    expect(majorVersion('^3.23.0')).toBe('3');
    expect(majorVersion('~2.1')).toBe('2');
  });

  test('refuses anything it cannot read', () => {
    expect(majorVersion(null)).toBeNull();
    expect(majorVersion('')).toBeNull();
    expect(majorVersion('latest')).toBeNull();
    expect(majorVersion('*')).toBeNull();
  });
});

describe('installedVersion', () => {
  test('reads the version of a package installed in that directory', () => {
    const modules = join(root, 'node_modules');
    install(modules, 'zod', '4.3.5');
    expect(installedVersion(modules, 'zod')).toBe('4.3.5');
  });

  test('reports null for a package that is not installed there', () => {
    const modules = join(root, 'node_modules');
    mkdirSync(modules, { recursive: true });
    expect(installedVersion(modules, 'zod')).toBeNull();
  });

  test('reports null for an unreadable manifest', () => {
    const modules = join(root, 'node_modules');
    mkdirSync(join(modules, 'broken'), { recursive: true });
    writeFileSync(join(modules, 'broken', 'package.json'), '{ not json');
    expect(installedVersion(modules, 'broken')).toBeNull();
  });
});

describe('shadowedNestedDeps', () => {
  test('reports a nested copy that the hoisted major cannot stand in for', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'session-tools-core', 'node_modules');
    install(hoisted, 'zod', '4.3.5');
    install(pkgModules, 'zod', '3.25.76');

    expect(shadowedNestedDeps(pkgModules, hoisted)).toEqual([
      { dep: 'zod', nested: '3.25.76', root: '4.3.5' },
    ]);
  });

  test('ignores a nested copy in the same major as the hoisted one', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    install(hoisted, 'zod', '3.25.76');
    install(pkgModules, 'zod', '3.23.0');

    expect(shadowedNestedDeps(pkgModules, hoisted)).toEqual([]);
  });

  test('ignores a nested copy with no hoisted counterpart', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    mkdirSync(hoisted, { recursive: true });
    install(pkgModules, 'only-nested', '1.0.0');

    expect(shadowedNestedDeps(pkgModules, hoisted)).toEqual([]);
  });

  test('ignores type-only packages', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    install(hoisted, '@types/node', '22.0.0');
    install(pkgModules, '@types/node', '18.0.0');

    expect(shadowedNestedDeps(pkgModules, hoisted)).toEqual([]);
  });

  test('expands scopes so a scoped package is compared by name', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    install(hoisted, '@scope/thing', '2.0.0');
    install(pkgModules, '@scope/thing', '1.4.0');

    const shadows = shadowedNestedDeps(pkgModules, hoisted);
    expect(shadows.map((s) => s.dep)).toEqual(['@scope/thing']);
  });

  test('is empty when the package has no nested node_modules at all', () => {
    const hoisted = join(root, 'node_modules');
    install(hoisted, 'zod', '4.3.5');
    expect(shadowedNestedDeps(join(root, 'packages', 'p', 'node_modules'), hoisted)).toEqual([]);
  });

  test('sorts the result so build logs are stable', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    for (const name of ['zod', 'alpha', 'middle']) {
      install(hoisted, name, '2.0.0');
      install(pkgModules, name, '1.0.0');
    }
    expect(shadowedNestedDeps(pkgModules, hoisted).map((s) => s.dep)).toEqual([
      'alpha',
      'middle',
      'zod',
    ]);
  });
});

describe('copyShadowedNestedDeps', () => {
  test('copies the nested package into the output, manifest and files', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'session-tools-core', 'node_modules');
    const dest = join(root, 'out', 'node_modules', 'packages', 'session-tools-core', 'node_modules');
    const zod3 = install(pkgModules, 'zod', '3.25.76');
    install(hoisted, 'zod', '4.3.5');

    const shadows = copyShadowedNestedDeps(pkgModules, hoisted, dest);

    expect(shadows).toEqual([{ dep: 'zod', nested: '3.25.76', root: '4.3.5' }]);
    expect(readFileSync(join(dest, 'zod', 'package.json'), 'utf-8')).toContain('"3.25.76"');
    // Everything in the installed package, not just the manifest.
    expect(readFileSync(join(dest, 'zod', 'index.js'), 'utf-8')).toBe(
      readFileSync(join(zod3, 'index.js'), 'utf-8'),
    );
  });

  test('leaves the hoisted copy alone', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    const dest = join(root, 'out', 'node_modules');
    install(hoisted, 'zod', '4.3.5');
    install(pkgModules, 'zod', '3.25.76');

    copyShadowedNestedDeps(pkgModules, hoisted, join(dest, 'packages', 'p', 'node_modules'));

    expect(installedVersion(hoisted, 'zod')).toBe('4.3.5');
  });

  test('does nothing when no nested copy shadows the hoisted one', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    const dest = join(root, 'out', 'node_modules');
    install(hoisted, 'zod', '4.3.5');

    expect(copyShadowedNestedDeps(pkgModules, hoisted, dest)).toEqual([]);
    expect(existsSync(dest)).toBe(false);
  });

  test('makes the copied copy the one resolution finds from that package', () => {
    const hoisted = join(root, 'node_modules');
    const pkgModules = join(root, 'packages', 'p', 'node_modules');
    const outModules = join(root, 'out', 'node_modules');
    const outPkgModules = join(outModules, 'packages', 'p', 'node_modules');
    install(hoisted, 'zod', '4.3.5');
    install(pkgModules, 'zod', '3.25.76');

    // Only the hoisted copy exists in the output, which is what the build did
    // before this step: Node resolves zod 4 from the package.
    install(outModules, 'zod', '4.3.5');
    const fromOutput = createRequire(join(outModules, 'packages', 'p', 'index.js'));
    expect(fromOutput.resolve('zod')).toContain(join('out', 'node_modules', 'zod'));

    copyShadowedNestedDeps(pkgModules, hoisted, outPkgModules);

    // After the step the package resolves its own copy, as it does in the monorepo.
    expect(fromOutput.resolve('zod')).toContain(join('packages', 'p', 'node_modules', 'zod'));
    expect(
      JSON.parse(readFileSync(fromOutput.resolve('zod/package.json'), 'utf-8')).version,
    ).toBe('3.25.76');
  });
});
