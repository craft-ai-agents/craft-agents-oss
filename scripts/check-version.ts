#!/usr/bin/env bun
/**
 * Version Check Script
 *
 * Validates that APP_VERSION in app-version.ts matches all package.json files.
 * Used in CI to catch version mismatches before merge.
 *
 * Usage: bun run scripts/check-version.ts
 * Exit code: 0 if all versions match, 1 if there's a mismatch
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const scriptDir = dirname(new URL(import.meta.url).pathname);
const repoRoot = dirname(scriptDir);

function getAppVersion(): string {
  const versionFile = join(repoRoot, 'packages/shared/src/version/app-version.ts');
  const content = readFileSync(versionFile, 'utf-8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error('Could not find APP_VERSION in app-version.ts');
  }
  return match[1];
}

function getPackageVersion(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);
  return pkg.version;
}

function main(): void {
  const appVersion = getAppVersion();
  console.log(`APP_VERSION: ${appVersion}`);
  console.log('');

  // Find all package.json files
  const packageFiles = [
    join(repoRoot, 'package.json'),
    ...readdirSync(join(repoRoot, 'apps')).map((dir) => join(repoRoot, 'apps', dir, 'package.json')),
    ...readdirSync(join(repoRoot, 'packages')).map((dir) => join(repoRoot, 'packages', dir, 'package.json')),
  ].filter((f) => existsSync(f));

  const mismatches: string[] = [];

  for (const file of packageFiles) {
    const relativePath = file.replace(repoRoot + '/', '');
    const pkgVersion = getPackageVersion(file);

    if (pkgVersion !== appVersion) {
      console.log(`  ✗ ${relativePath}: ${pkgVersion} (expected ${appVersion})`);
      mismatches.push(relativePath);
    } else {
      console.log(`  ✓ ${relativePath}: ${pkgVersion}`);
    }
  }

  console.log('');

  if (mismatches.length > 0) {
    console.error(`ERROR: ${mismatches.length} package(s) have mismatched versions.`);
    console.error('');
    console.error('To fix, run: bun run scripts/sync-version.ts');
    process.exit(1);
  }

  console.log('✓ All versions match!');
}

main();
