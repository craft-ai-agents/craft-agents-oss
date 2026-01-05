/**
 * Sync Version Script
 *
 * Reads APP_VERSION from packages/shared/src/version/app-version.ts
 * and updates all package.json files in the monorepo.
 *
 * Usage: bun run scripts/sync-version.ts
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

const scriptDir = import.meta.dir;
const repoRoot = dirname(scriptDir);

// Read APP_VERSION from source
function getAppVersion(): string {
  const versionFile = join(repoRoot, 'packages/shared/src/version/app-version.ts');
  const content = readFileSync(versionFile, 'utf-8');
  const match = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    throw new Error('Could not find APP_VERSION in app-version.ts');
  }
  return match[1];
}

// Update version in a package.json file
function updatePackageJson(filePath: string, version: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);

  if (pkg.version === version) {
    return false; // Already up to date
  }

  pkg.version = version;
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  return true;
}

function main() {
  const version = getAppVersion();
  console.log(`Syncing version: ${version}`);
  console.log('');

  // Find all package.json files
  const packageFiles = [
    join(repoRoot, 'package.json'),
    ...readdirSync(join(repoRoot, 'apps')).map(dir => join(repoRoot, 'apps', dir, 'package.json')),
    ...readdirSync(join(repoRoot, 'packages')).map(dir => join(repoRoot, 'packages', dir, 'package.json')),
  ].filter(f => {
    try {
      readFileSync(f);
      return true;
    } catch {
      return false;
    }
  });

  let updated = 0;
  for (const file of packageFiles) {
    const relativePath = file.replace(repoRoot + '/', '');
    if (updatePackageJson(file, version)) {
      console.log(`  ✓ Updated ${relativePath}`);
      updated++;
    } else {
      console.log(`  - ${relativePath} (already ${version})`);
    }
  }

  console.log('');
  console.log(`Done. Updated ${updated} file(s).`);

  return version;
}

// Export for use in build.ts
export { getAppVersion };

// Run if executed directly
if (import.meta.main) {
  try {
    main();
  } catch (err: unknown) {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  }
}
