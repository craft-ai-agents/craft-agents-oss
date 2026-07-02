import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export interface FakeSyncHarness {
  machineA: string;
  machineB: string;
  syncAtoB(options?: FakeSyncOptions): void;
  syncBtoA(options?: FakeSyncOptions): void;
  createProviderConflict(from: 'a' | 'b', relativePath: string, label?: string): string;
}

export interface FakeSyncOptions {
  conflictPaths?: string[];
  partialPaths?: string[];
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function copyTree(source: string, target: string, options: FakeSyncOptions = {}): void {
  for (const file of walkFiles(source)) {
    const rel = relative(source, file).split('\\').join('/');
    const targetFile = join(target, rel);
    mkdirSync(dirname(targetFile), { recursive: true });
    if (existsSync(targetFile) && statSync(targetFile).mtimeMs > statSync(file).mtimeMs) continue;
    if (options.conflictPaths?.includes(rel)) {
      const conflictFile = targetFile.replace(/\.json$/i, " (conflicted copy).json");
      writeFileSync(conflictFile, readFileSync(file), 'utf-8');
      continue;
    }
    if (options.partialPaths?.includes(rel)) {
      writeFileSync(targetFile, readFileSync(file, 'utf-8').slice(0, 8), 'utf-8');
      continue;
    }
    writeFileSync(targetFile, readFileSync(file), 'utf-8');
  }
}

export function createFakeSyncHarness(root: string): FakeSyncHarness {
  const machineA = join(root, 'machine-a');
  const machineB = join(root, 'machine-b');
  rmSync(machineA, { recursive: true, force: true });
  rmSync(machineB, { recursive: true, force: true });
  mkdirSync(machineA, { recursive: true });
  mkdirSync(machineB, { recursive: true });
  return {
    machineA,
    machineB,
    syncAtoB: (options) => copyTree(machineA, machineB, options),
    syncBtoA: (options) => copyTree(machineB, machineA, options),
    createProviderConflict(from, relativePath, label = 'conflicted copy') {
      const rootPath = from === 'a' ? machineA : machineB;
      const source = join(rootPath, relativePath);
      const conflict = source.replace(/\.json$/i, ` (${label}).json`);
      mkdirSync(dirname(conflict), { recursive: true });
      writeFileSync(conflict, readFileSync(source), 'utf-8');
      return conflict;
    },
  };
}
