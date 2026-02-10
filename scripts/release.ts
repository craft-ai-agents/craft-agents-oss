#!/usr/bin/env bun
/**
 * Release CLI for Craft Agent
 *
 * Usage:
 *   bun run release patch              # 0.2.24 → 0.2.25
 *   bun run release minor              # 0.2.24 → 0.3.0
 *   bun run release major              # 0.2.24 → 1.0.0
 *   bun run release 0.3.0              # Set explicit version
 *   bun run release patch --tag        # Also create git tag
 *   bun run release patch --oss        # Also sync to OSS repo
 *   bun run release --oss-only         # Just sync existing version to OSS
 */

import { $ } from 'bun';
import { parseArgs } from 'util';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';

const scriptDir = dirname(new URL(import.meta.url).pathname);
const repoRoot = dirname(scriptDir);
const releaseNotesDir = join(repoRoot, 'apps/electron/resources/release-notes');

type BumpType = 'patch' | 'minor' | 'major';

function showHelp(): void {
  console.log(`
Release CLI for Craft Agent

Usage:
  bun run release <version|bump> [options]

Version:
  patch          Bump patch version (0.2.24 → 0.2.25)
  minor          Bump minor version (0.2.24 → 0.3.0)
  major          Bump major version (0.2.24 → 1.0.0)
  X.Y.Z          Set explicit version

Options:
  --tag          Create git tag (vX.Y.Z)
  --push         Push commit and tag to origin
  --oss          Sync to OSS repo after release
  --oss-only     Just sync existing version to OSS (no version bump)
  --dry-run      Show what would be done without making changes
  --help         Show this help message

Examples:
  bun run release patch                    # Bump and commit
  bun run release patch --tag --push       # Bump, tag, and push
  bun run release minor --oss              # Bump and sync to OSS
  bun run release --oss-only               # Just sync existing version
`);
}

// Read version from the shared package.json (single source of truth)
function getCurrentVersion(): string {
  const pkgPath = join(repoRoot, 'packages/shared/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function bumpVersion(current: string, type: BumpType): string {
  const [major, minor, patch] = current.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

// Check if release notes file exists for the given version.
// Returns the file path if it exists, null otherwise.
function getReleaseNotesPath(version: string): string | null {
  const notesPath = join(releaseNotesDir, `${version}.md`);
  return existsSync(notesPath) ? notesPath : null;
}

function updatePackageJson(filePath: string, version: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);

  if (pkg.version === version) {
    return false;
  }

  pkg.version = version;
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  return true;
}

function syncAllPackageJsons(version: string): number {
  const packageFiles = [
    join(repoRoot, 'package.json'),
    ...readdirSync(join(repoRoot, 'apps')).map((dir) => join(repoRoot, 'apps', dir, 'package.json')),
    ...readdirSync(join(repoRoot, 'packages')).map((dir) => join(repoRoot, 'packages', dir, 'package.json')),
  ].filter((f) => existsSync(f));

  let updated = 0;
  for (const file of packageFiles) {
    const relativePath = file.replace(repoRoot + '/', '');
    if (updatePackageJson(file, version)) {
      console.log(`  ✓ Updated ${relativePath}`);
      updated++;
    }
  }

  return updated;
}

async function ensureMainBranch(): Promise<void> {
  // Check current branch
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
  if (branch !== 'main') {
    console.error(`Error: --tag requires being on the 'main' branch`);
    console.error(`  Current branch: ${branch}`);
    console.error(`  Run: git checkout main`);
    process.exit(1);
  }

  // Fetch latest from origin
  await $`git fetch origin main`.quiet();

  // Check if local main is up to date with origin/main
  const local = (await $`git rev-parse HEAD`.text()).trim();
  const remote = (await $`git rev-parse origin/main`.text()).trim();

  if (local !== remote) {
    // Check if we're behind, ahead, or diverged
    const mergeBase = (await $`git merge-base HEAD origin/main`.text()).trim();
    if (mergeBase === local) {
      console.error(`Error: Local 'main' is behind origin/main`);
      console.error(`  Run: git pull origin main`);
    } else if (mergeBase === remote) {
      console.error(`Error: Local 'main' has unpushed commits`);
      console.error(`  Run: git push origin main`);
    } else {
      console.error(`Error: Local 'main' has diverged from origin/main`);
      console.error(`  Run: git pull --rebase origin main`);
    }
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      tag: { type: 'boolean', default: false },
      push: { type: 'boolean', default: false },
      oss: { type: 'boolean', default: false },
      'oss-only': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const dryRun = values['dry-run'] ?? false;
  const ossOnly = values['oss-only'] ?? false;

  // Enforce main branch when creating tags
  if (values.tag && !dryRun) {
    await ensureMainBranch();
  }

  const currentVersion = getCurrentVersion();
  console.log(`Current version: ${currentVersion}`);

  // Handle --oss-only
  if (ossOnly) {
    console.log('\nSyncing to OSS repository...');
    if (!dryRun) {
      const ossScript = join(repoRoot, 'scripts', 'oss-sync.ts');
      if (existsSync(ossScript)) {
        await $`cd ${repoRoot} && bun run ${ossScript}`;
      } else {
        // Fall back to bash script
        await $`cd ${repoRoot} && bash scripts/sync-to-oss.sh`;
      }
    }
    console.log('\n✓ OSS sync complete!');
    return;
  }

  // Determine new version
  const versionArg = positionals[0];
  if (!versionArg) {
    console.error('Error: No version or bump type specified');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  let newVersion: string;
  if (['patch', 'minor', 'major'].includes(versionArg)) {
    newVersion = bumpVersion(currentVersion, versionArg as BumpType);
  } else if (isValidVersion(versionArg)) {
    newVersion = versionArg;
  } else {
    console.error(`Error: Invalid version or bump type: ${versionArg}`);
    console.error('Expected: patch, minor, major, or X.Y.Z');
    process.exit(1);
  }

  if (newVersion === currentVersion) {
    console.log('Version is already up to date');
    process.exit(0);
  }

  console.log(`New version: ${newVersion}`);

  // Validate release notes file exists (required for CI workflow).
  // This ensures the release won't fail in GitHub Actions due to missing notes.
  const releaseNotesPath = getReleaseNotesPath(newVersion);
  if (!releaseNotesPath) {
    const expectedPath = `apps/electron/resources/release-notes/${newVersion}.md`;
    console.error(`\n❌ Missing release notes: ${expectedPath}`);
    console.error(`\nThe release workflow requires this file to exist.`);
    console.error(`Create it with content like:\n`);
    console.error(`  ## Features`);
    console.error(`  - New feature description\n`);
    console.error(`  ## Improvements`);
    console.error(`  - Improvement description\n`);
    console.error(`  ## Bug Fixes`);
    console.error(`  - Fix description\n`);
    process.exit(1);
  }
  console.log(`Release notes: ${releaseNotesPath.replace(repoRoot + '/', '')}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would perform the following actions:');
    console.log(`  1. Update all package.json files to ${newVersion}`);
    console.log(`  2. Create git commit: "chore: release v${newVersion}"`);
    if (values.tag) console.log(`  3. Create git tag: v${newVersion}`);
    if (values.push) console.log(`  4. Push to origin`);
    if (values.oss) console.log(`  5. Sync to OSS repository`);
    return;
  }

  // 1. Update all package.json files (single source of truth)
  console.log('\nUpdating package.json files...');
  const updated = syncAllPackageJsons(newVersion);
  console.log(`  Updated ${updated} file(s)`);

  // 2. Create git commit
  console.log('\nCreating git commit...');
  await $`cd ${repoRoot} && git add -A`;
  await $`cd ${repoRoot} && git commit -m ${"chore: release v" + newVersion + "\n\nCo-Authored-By: Craft Agent <agents-noreply@craft.do>"}`;
  console.log(`  ✓ Created commit`);

  // 3. Create tag (optional)
  if (values.tag) {
    console.log('\nCreating git tag...');
    await $`cd ${repoRoot} && git tag v${newVersion}`;
    console.log(`  ✓ Created tag v${newVersion}`);
  }

  // 4. Push (optional)
  if (values.push) {
    console.log('\nPushing to origin...');
    await $`cd ${repoRoot} && git push`;
    if (values.tag) {
      await $`cd ${repoRoot} && git push --tags`;
    }
    console.log(`  ✓ Pushed to origin`);
  }

  // 5. OSS sync (optional)
  if (values.oss) {
    console.log('\nSyncing to OSS repository...');
    const ossScript = join(repoRoot, 'scripts', 'oss-sync.ts');
    if (existsSync(ossScript)) {
      await $`cd ${repoRoot} && bun run ${ossScript}`;
    } else {
      // Fall back to bash script
      await $`cd ${repoRoot} && bash scripts/sync-to-oss.sh`;
    }
    console.log(`  ✓ OSS sync complete`);
  }

  console.log(`\n✓ Released v${newVersion}!`);

  if (!values.push) {
    console.log('\nNext steps:');
    console.log(`  git push origin ${values.tag ? '&& git push --tags' : ''}`);
    console.log('  # Then trigger CI build via GitHub Actions');
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
