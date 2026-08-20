import { describe, expect, it } from 'bun:test';

import { getGitLock } from '../git-locks';
import { MANIFEST_DATA, TOOL_PLATFORM_MATRIX } from '../manifest-data';
import { currentPlatform, loadManifest, TOOLCHAIN_MANIFEST, toolchainPaths } from '../manifest';
import { OPENCLAW_NPM_PIN, getNpmLock } from '../npm-locks';
import { getPipRequirements } from '../pip-locks';
import type { ToolName } from '../types';

const HEX_64 = /^[0-9a-f]{64}$/;

describe('manifest validation', () => {
  it('каждый артефакт имеет непустые url/sha256/size/binPaths', () => {
    expect(TOOLCHAIN_MANIFEST.length).toBeGreaterThan(0);
    for (const entry of TOOLCHAIN_MANIFEST) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
      for (const [platform, artifact] of Object.entries(entry.artifacts)) {
        expect(platform).toMatch(/^(darwin-arm64|darwin-x64|linux-x64|win32-x64)$/);
        expect(artifact).toBeDefined();
        if (!artifact) continue;
        // uv-python артефакты ставятся вендорным `uv python install` — прямой
        // загрузки нет, url/sha256/size не применяются (контракт manifest-data).
        if (artifact.archive === 'uv-python') {
          expect(artifact.binPaths.length).toBeGreaterThan(0);
          continue;
        }
        expect(artifact.url.length).toBeGreaterThan(0);
        expect(artifact.url).toMatch(/^https:\/\//);
        expect(artifact.sha256).toMatch(HEX_64);
        expect(artifact.size).toBeGreaterThan(0);
        expect(artifact.binPaths.length).toBeGreaterThan(0);
        for (const binPath of artifact.binPaths) {
          expect(binPath.length).toBeGreaterThan(0);
          expect(binPath.startsWith('/')).toBe(false);
        }
      }
    }
  });

  it('git публикуется только под win32-x64 согласно матрице', () => {
    expect(TOOL_PLATFORM_MATRIX.git).toEqual(['win32-x64']);
  });

  it('каждый ToolName из TOOL_PLATFORM_MATRIX имеет запись в MANIFEST_DATA; npm/git-npm/pip — pinned lock', () => {
    // Регрессия (MAJOR): gbrain был в ToolName union, TOOL_PLATFORM_MATRIX и
    // git-locks.ts, но ЗАПИСИ В MANIFEST_DATA не было — buildManifest молча его
    // не собирал, и инструмент был недостижим ни в ensureAll, ни в status/update.
    // Документированные «особые» записи ТОЖЕ обязаны присутствовать в манифесте:
    // git (на darwin/linux — системный бинарник, артефакт только под win32-x64)
    // и python (artifacts-заглушки uv-managed, ставится `uv python install`).
    // Матрица типизирована Record<ToolName, ...> — её ключи исчерпывают union.
    const matrixNames = Object.keys(TOOL_PLATFORM_MATRIX) as ToolName[];
    expect(matrixNames.length).toBeGreaterThan(0);

    const missingInManifest = matrixNames.filter((name) => !MANIFEST_DATA[name]);
    expect(missingInManifest).toEqual([]);

    // kind npm: установка fail-closed по npm-locks.ts — lock обязан существовать.
    const npmWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && (data.kind ?? 'binary') === 'npm' && getNpmLock(name, data.version) === null;
    });
    expect(npmWithoutLock).toEqual([]);

    // kind git-npm: установка fail-closed по git-locks.ts — lock обязан существовать.
    const gitNpmWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && data.kind === 'git-npm' && getGitLock(name, data.version) === undefined;
    });
    expect(gitNpmWithoutLock).toEqual([]);

    // kind pip: установка fail-closed по pip-locks.ts — requirements lock обязан существовать.
    const pipWithoutLock = matrixNames.filter((name) => {
      const data = MANIFEST_DATA[name];
      return data && data.kind === 'pip' && getPipRequirements(name, data.version) === null;
    });
    expect(pipWithoutLock).toEqual([]);
  });

  it('OpenClaw is an opt-in exact npm pin with a complete integrity-locked dependency graph', () => {
    const openclaw = MANIFEST_DATA.openclaw;
    expect(openclaw).toMatchObject({
      version: '2026.7.1-2',
      kind: 'npm',
      tier: 'opt-in',
      dependsOn: ['node'],
    });
    expect(OPENCLAW_NPM_PIN).toEqual({
      packageName: 'openclaw',
      version: '2026.7.1-2',
      tarballUrl: 'https://registry.npmjs.org/openclaw/-/openclaw-2026.7.1-2.tgz',
      tarballSha256: '5bb525f36f471a41239615d321c441778c7e1c007018ed6d84b795be77803276',
      tarballIntegrity: 'sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g==',
      requiredNodeRange: '>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0',
      entrypoint: 'openclaw.mjs',
    });
    expect(MANIFEST_DATA.node?.version).toBe('22.23.2');
    expect(TOOL_PLATFORM_MATRIX.openclaw).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'win32-x64',
    ]);

    for (const artifact of Object.values(openclaw?.artifacts ?? {})) {
      expect(artifact?.url).toBe(OPENCLAW_NPM_PIN.tarballUrl);
      expect(artifact?.sha256).toBe(OPENCLAW_NPM_PIN.tarballSha256);
      expect(artifact?.size).toBe(19728152);
    }

    const lock = getNpmLock('openclaw', '2026.7.1-2');
    expect(lock).not.toBeNull();
    const parsed = JSON.parse(lock ?? '{}');
    expect(parsed.lockfileVersion).toBe(3);
    expect(parsed.packages?.['']?.name).toBe('openclaw');
    expect(parsed.packages?.['']?.version).toBe('2026.7.1-2');
    expect(Object.entries(parsed.packages ?? {}).every(([packagePath, pkg]) => {
      if (packagePath === '') return true;
      const record = pkg as { resolved?: unknown; integrity?: unknown; link?: unknown };
      return record.link === true || (
        typeof record.resolved === 'string' &&
        record.resolved.startsWith('https://registry.npmjs.org/') &&
        typeof record.integrity === 'string'
      );
    })).toBe(true);
  });

  it('gbrain виден ensureAll как default-on git-npm инструмент (регрессия MAJOR)', () => {
    // ensureAll перебирает TOOLCHAIN_MANIFEST (собран из MANIFEST_DATA + матрицы):
    // tier default-on без disabled-пометки => gbrain ОБЯЗАН попадать в план установки.
    const gbrain = TOOLCHAIN_MANIFEST.find((e) => e.name === 'gbrain');
    expect(gbrain).toBeDefined();
    expect(gbrain?.kind).toBe('git-npm');
    expect(gbrain?.tier).toBe('default-on');
    expect(gbrain?.version).toBe('15b9863d1363');
    expect(gbrain?.dependsOn).toEqual(['bun']);
    // Платформенная матрица покрывает текущую платформу — иначе ensureAll пропустил бы его.
    expect(gbrain?.platforms).toContain(currentPlatform());
  });

  it('loadManifest возвращает собранный манифест (jq присутствует)', () => {
    const manifest = loadManifest();
    expect(manifest).toBe(TOOLCHAIN_MANIFEST);
    const jq = manifest.find((e) => e.name === 'jq');
    expect(jq).toBeDefined();
    expect(MANIFEST_DATA.jq?.version).toBe(jq?.version);
  });

  it('toolchainPaths собирает пути от config-dir', () => {
    const paths = toolchainPaths('/tmp/craft-test');
    expect(paths.toolchainDir).toBe('/tmp/craft-test/toolchain');
    expect(paths.downloadsDir).toBe('/tmp/craft-test/downloads');
    expect(paths.stateFile).toBe('/tmp/craft-test/toolchain/state.json');
  });

  it('currentPlatform возвращает валидную платформу манифеста', () => {
    expect(['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']).toContain(currentPlatform());
  });
});
