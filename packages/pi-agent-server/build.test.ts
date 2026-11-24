import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  RESIZE_WORKER,
  SOURCE_REWRITES,
  applyRewrite,
  findInlinedBuildPaths,
  type SourceRewrite,
} from './build.ts';

const rewrite: SourceRewrite = { name: 'test rewrite', filter: /x/, from: 'join(__dirname)', to: 'join($&dir)' };

describe('applyRewrite', () => {
  it('replaces the single occurrence literally', () => {
    expect(applyRewrite('a(join(__dirname))', rewrite, 'f.js')).toBe('a(join($&dir))');
  });

  it('throws when the expression is missing', () => {
    expect(() => applyRewrite('a(join(other))', rewrite, 'f.js')).toThrow('test rewrite');
  });

  it('throws when the expression is ambiguous', () => {
    expect(() => applyRewrite('join(__dirname) join(__dirname)', rewrite, 'f.js')).toThrow('exactly one');
  });
});

describe('SOURCE_REWRITES', () => {
  const sdkDir = dirname(Bun.resolveSync('@earendil-works/pi-coding-agent', import.meta.dir));
  const sources: Record<string, string> = {
    'photon wasm resolved next to the bundle': join(
      dirname(Bun.resolveSync('@silvia-odwyer/photon-node', sdkDir)),
      'photon_rs.js',
    ),
    'resize worker pinned to the bundle': join(sdkDir, 'utils', 'image-resize.js'),
  };

  for (const entry of SOURCE_REWRITES) {
    it(`still matches the installed dependency: ${entry.name}`, () => {
      const path = sources[entry.name];
      expect(path).toBeDefined();
      expect(entry.filter.test(path!)).toBe(true);
      expect(() => applyRewrite(readFileSync(path!, 'utf8'), entry, path!)).not.toThrow();
    });
  }

  it('pins the SDK worker to the bundled copy', () => {
    expect(SOURCE_REWRITES.some((entry) => entry.to.includes(`"./${RESIZE_WORKER}", import.meta.url`))).toBe(true);
  });
});

describe('findInlinedBuildPaths', () => {
  const root = '/work/repo';

  it('reports inlined __dirname and __filename under the repo', () => {
    const bundle = [
      'var __dirname = "/work/repo/node_modules/@silvia-odwyer/photon-node";',
      'var __filename = "/work/repo/node_modules/pkg/index.js";',
    ].join('\n');
    expect(findInlinedBuildPaths(bundle, root)).toEqual([
      'node_modules/@silvia-odwyer/photon-node',
      'node_modules/pkg/index.js',
    ]);
  });

  it('ignores paths outside the repo and non-literal assignments', () => {
    const bundle = [
      'var __dirname = "/elsewhere/node_modules/pkg";',
      'var __dirname = import.meta.dirname;',
      'var __dirname = "relative/dir";',
    ].join('\n');
    expect(findInlinedBuildPaths(bundle, root)).toEqual([]);
  });
});
