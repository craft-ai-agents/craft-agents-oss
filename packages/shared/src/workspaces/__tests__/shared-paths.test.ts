import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  copyFileIntoWorkspaceVault,
  createExternalPathRef,
  createWorkspaceRelativePathRef,
  loadSharedPathOverrides,
  inspectSharedPathRef,
  resolveSharedPathRef,
  setSharedPathOverride,
  WORKSPACE_VAULT_OBJECTS_DIR,
} from '../shared-paths.ts';

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('shared workspace path refs', () => {
  it('resolves workspace-relative refs after moving between fake home dirs', () => {
    const homeA = makeDir('shared-path-home-a-');
    const homeB = makeDir('shared-path-home-b-');
    const workspaceA = join(homeA, 'Creative Command');
    const workspaceB = join(homeB, 'Creative Command');
    mkdirSync(join(workspaceA, 'assets'), { recursive: true });
    mkdirSync(join(workspaceB, 'assets'), { recursive: true });
    writeFileSync(join(workspaceA, 'assets', 'cover.txt'), 'cover', 'utf-8');
    writeFileSync(join(workspaceB, 'assets', 'cover.txt'), 'cover', 'utf-8');

    const ref = createWorkspaceRelativePathRef(workspaceA, join(workspaceA, 'assets', 'cover.txt'), { expectedSizeBytes: 5 });

    expect(ref.path).toBe('assets/cover.txt');
    expect(resolveSharedPathRef(workspaceB, ref)).toBe(join(workspaceB, 'assets', 'cover.txt'));
    expect(inspectSharedPathRef(workspaceB, ref).status).toBe('ready');
  });

  it('copies external files into workspace vault and resolves them from the moved workspace root', () => {
    const externalRoot = makeDir('shared-path-external-');
    const workspaceA = makeDir('shared-path-workspace-a-');
    const workspaceB = makeDir('shared-path-workspace-b-');
    const source = join(externalRoot, 'master.wav');
    writeFileSync(source, 'audio-data', 'utf-8');

    const ref = copyFileIntoWorkspaceVault(workspaceA, source);
    const copiedPath = resolveSharedPathRef(workspaceA, ref);
    const movedCopy = join(workspaceB, ref.path!);
    mkdirSync(dirname(movedCopy), { recursive: true });
    writeFileSync(movedCopy, readFileSync(copiedPath));

    expect(ref.kind).toBe('vault-object');
    expect(ref.path?.startsWith(`${WORKSPACE_VAULT_OBJECTS_DIR}/`)).toBe(true);
    expect('originalPath' in ref).toBe(false);
    expect(readFileSync(resolveSharedPathRef(workspaceB, ref), 'utf-8')).toBe('audio-data');
    expect(inspectSharedPathRef(workspaceB, ref).status).toBe('ready');
  });

  it('detects same-size vault content corruption with manifest hash', () => {
    const externalRoot = makeDir('shared-path-external-');
    const workspace = makeDir('shared-path-workspace-');
    const source = join(externalRoot, 'master.wav');
    writeFileSync(source, 'audio-data', 'utf-8');

    const ref = copyFileIntoWorkspaceVault(workspace, source);
    writeFileSync(resolveSharedPathRef(workspace, ref), 'audio-DATA', 'utf-8');

    expect(inspectSharedPathRef(workspace, ref).status).toBe('hash-mismatch');
  });

  it('keeps external linked files portable but reports missing until repaired on another machine', () => {
    const homeA = makeDir('shared-path-home-a-');
    const homeB = makeDir('shared-path-home-b-');
    const workspaceB = makeDir('shared-path-workspace-b-');
    const sourceA = join(homeA, 'Desktop', 'references', 'photo.png');
    const sourceB = join(homeB, 'Media', 'photo.png');
    mkdirSync(dirname(sourceA), { recursive: true });
    mkdirSync(dirname(sourceB), { recursive: true });
    writeFileSync(sourceA, 'image-a', 'utf-8');
    writeFileSync(sourceB, 'image-b', 'utf-8');

    const ref = createExternalPathRef(sourceA, {
      homeDir: homeA,
      refId: 'press-photo',
      expectedSizeBytes: 7,
    });

    expect(ref.kind).toBe('external');
    expect(ref.refId).toBe('press-photo');
    expect('originalPath' in ref).toBe(false);
    const missing = inspectSharedPathRef(workspaceB, ref, { homeDir: homeB });
    expect(missing.status).toBe('missing');
    expect(missing.reason).toContain('Add a local path override');
    expect(missing.repair?.message).toBe(missing.reason);
    expect(missing.repair).toEqual({
      kind: 'external-path-override',
      refId: 'press-photo',
      label: undefined,
      message: expect.stringContaining('Add a local path override'),
    });
    expect(() => resolveSharedPathRef(workspaceB, ref, { homeDir: homeB })).toThrow('External path override required');
    expect(resolveSharedPathRef(workspaceB, ref, {
      homeDir: homeB,
      externalOverrides: { 'press-photo': sourceB },
    })).toBe(sourceB);
    expect(inspectSharedPathRef(workspaceB, ref, {
      homeDir: homeB,
      externalOverrides: { 'press-photo': sourceB },
    }).status).toBe('ready');
  });

  it('persists private per-machine path overrides', () => {
    const privateRoot = makeDir('shared-path-private-');
    const externalRoot = makeDir('shared-path-external-');
    process.env.CRAFT_CONFIG_DIR = privateRoot;
    const replacement = join(externalRoot, 'Press Photo.png');
    writeFileSync(replacement, 'image-b', 'utf-8');

    const overrides = setSharedPathOverride('workspace-1', 'press-photo', replacement);

    expect(overrides['press-photo']).toBe(replacement);
    expect(loadSharedPathOverrides('workspace-1')).toEqual({ 'press-photo': replacement });
  });

  it('rejects cwd-relative external refs', () => {
    expect(() => createExternalPathRef('relative/file.png')).toThrow('absolute path');
  });

  it('detects iCloud-style placeholder sibling files', () => {
    const workspace = makeDir('shared-path-icloud-');
    mkdirSync(join(workspace, 'assets'), { recursive: true });
    const expectedPath = join(workspace, 'assets', 'cover.png');
    writeFileSync(join(workspace, 'assets', '.cover.png.icloud'), 'placeholder', 'utf-8');

    const ref = {
      version: 1 as const,
      kind: 'workspace' as const,
      path: 'assets/cover.png',
      expectedSizeBytes: 10,
    };

    const readiness = inspectSharedPathRef(workspace, ref);
    expect(readiness.status).toBe('placeholder');
    expect(readiness.absolutePath).toBe(expectedPath);
  });
});
