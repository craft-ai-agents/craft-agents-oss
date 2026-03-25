/**
 * Tests for runtime-resolver.ts
 *
 * Verifies:
 * - Packaged server path resolution with dist/resources/ fallback
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBackendRuntimePaths } from '../internal/runtime-resolver.ts';
import type { BackendHostRuntimeContext } from '../types.ts';

describe('resolveServerPath fallback', () => {
  const tmpBase = join(tmpdir(), `resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds server in dist/resources/ when resources/ does not exist', () => {
    // Simulate packaged app where server is at dist/resources/<name>/index.js
    const appRoot = join(tmpBase, 'app');
    const serverDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, 'index.js'), '// stub');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(serverDir, 'index.js'));
  });

  it('prefers resources/ over dist/resources/ when both exist', () => {
    const appRoot = join(tmpBase, 'app2');

    // Create both paths
    const primaryDir = join(appRoot, 'resources', 'pi-agent-server');
    const fallbackDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(primaryDir, { recursive: true });
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(join(primaryDir, 'index.js'), '// primary');
    writeFileSync(join(fallbackDir, 'index.js'), '// fallback');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(primaryDir, 'index.js'));
  });

  it('falls back to src/index.ts in non-packaged runtime when dist is missing', () => {
    const appRoot = join(tmpBase, 'app3');
    const serverDir = join(appRoot, 'packages', 'pi-agent-server', 'src');
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, 'index.ts'), '// source entry');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      isPackaged: false,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(serverDir, 'index.ts'));
  });

  it('uses the current Bun executable for non-packaged runtime fallback', () => {
    const appRoot = join(tmpBase, 'app4');
    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      isPackaged: false,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.nodeRuntimePath).toBe(process.execPath);
  });
});
