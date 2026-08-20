import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { toolchainPaths } from '../manifest';
import { createResolver } from '../resolver';
import type { ToolEntry } from '../types';

const isWindows = process.platform === 'win32';
const binName = (n: string) => (isWindows ? `${n}.exe` : n);

let tmpDir: string;
let pathShimDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-res-'));
  pathShimDir = path.join(tmpDir, 'path-shim');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function putExecutable(file: string, content = '#!/bin/sh\ntrue\n'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (!isWindows) fs.chmodSync(file, 0o755);
}

const FAKE_MANIFEST: ToolEntry[] = [
  {
    name: 'jq',
    version: '1.0.0',
    displayName: 'jq',
    artifacts: {
      [process.platform === 'win32' ? 'win32-x64' : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64']: {
        url: 'file://fixture',
        sha256: 'a'.repeat(64),
        size: 1,
        archive: 'raw',
        binPaths: ['bin/jq'],
      },
    },
  },
];

describe('resolver', () => {
  it('toolchain имеет приоритет над PATH', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg1'));
    const tcBin = path.join(paths.toolchainDir, 'jq', 'current', 'bin', binName('jq'));
    // эмулируем установленный toolchain ('current' как реальная директория)
    putExecutable(tcBin, '#!/bin/sh\necho toolchain\n');
    putExecutable(path.join(pathShimDir, binName('jq')), '#!/bin/sh\necho system\n');

    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: pathShimDir });
    expect(await resolver.findExecutable('jq')).toBe(tcBin);
  });

  it('fallback на PATH, когда в toolchain пусто', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg2'));
    putExecutable(path.join(pathShimDir, binName('jq')));
    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: pathShimDir });
    expect(await resolver.findExecutable('jq')).toBe(path.join(pathShimDir, binName('jq')));
  });

  it('null, когда нигде нет', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg3'));
    const resolver = createResolver(paths, {
      manifest: FAKE_MANIFEST,
      pathEnv: path.join(tmpDir, 'empty-path'),
    });
    expect(await resolver.findExecutable('definitely-missing-tool')).toBeNull();
  });

  it('toolchainPathPrefix содержит bin-директории только установленных инструментов', async () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg4'));
    putExecutable(path.join(paths.toolchainDir, 'jq', 'current', 'bin', binName('jq')));
    const resolver = createResolver(paths, { manifest: FAKE_MANIFEST, pathEnv: '' });
    const prefix = await resolver.toolchainPathPrefix();
    expect(prefix).toBe(path.join(paths.toolchainDir, 'jq', 'current', 'bin'));

    const emptyResolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg5')), {
      manifest: FAKE_MANIFEST,
      pathEnv: '',
    });
    expect(await emptyResolver.toolchainPathPrefix()).toBe('');
  });

  it('toolchainDir возвращает корень из paths', () => {
    const paths = toolchainPaths(path.join(tmpDir, 'cfg6'));
    expect(createResolver(paths).toolchainDir()).toBe(paths.toolchainDir);
  });

  describe('win32 (platform DI)', () => {
    const WIN_MANIFEST: ToolEntry[] = [
      {
        name: 'omp',
        version: '17.2.10',
        displayName: 'omp',
        artifacts: {
          'win32-x64': {
            url: 'file://fixture',
            sha256: 'a'.repeat(64),
            size: 1,
            archive: 'tar.gz',
            binPaths: ['bin/omp', 'bin/omp.cmd'],
          },
        },
      },
    ];

    it('toolchain .cmd-resolver находит omp.cmd по базовому имени omp', async () => {
      const paths = toolchainPaths(path.join(tmpDir, 'cfg-win1'));
      const tcBin = path.join(paths.toolchainDir, 'omp', 'current', 'bin', 'omp.cmd');
      putExecutable(tcBin, '@echo off\r\n');
      const resolver = createResolver(paths, {
        manifest: WIN_MANIFEST,
        pathEnv: path.join(tmpDir, 'empty-path'),
        platform: 'win32',
      });
      expect(await resolver.findExecutable('omp')).toBe(tcBin);
    });

    it('PATH-поиск win32 пробует .cmd после .exe', async () => {
      const shim = path.join(tmpDir, 'win-shim');
      putExecutable(path.join(shim, 'npx.cmd'), '@echo off\r\n');
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win2')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'win32',
      });
      expect(await resolver.findExecutable('npx')).toBe(path.join(shim, 'npx.cmd'));
    });

    it('имя с расширением (.exe/.cmd) не дополняется', async () => {
      const shim = path.join(tmpDir, 'win-shim2');
      putExecutable(path.join(shim, 'uv.exe'), '');
      putExecutable(path.join(shim, 'omp.cmd'), '@echo off\r\n');
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win3')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'win32',
      });
      expect(await resolver.findExecutable('uv.exe')).toBe(path.join(shim, 'uv.exe'));
      expect(await resolver.findExecutable('omp.cmd')).toBe(path.join(shim, 'omp.cmd'));
    });

    it('posix-семантика без DI не трогает .cmd', async () => {
      const shim = path.join(tmpDir, 'posix-shim');
      putExecutable(path.join(shim, 'something'));
      const resolver = createResolver(toolchainPaths(path.join(tmpDir, 'cfg-win4')), {
        manifest: WIN_MANIFEST,
        pathEnv: shim,
        platform: 'linux',
      });
      expect(await resolver.findExecutable('something')).toBe(path.join(shim, 'something'));
      expect(await resolver.findExecutable('something.cmd')).toBeNull();
    });
  });
});
