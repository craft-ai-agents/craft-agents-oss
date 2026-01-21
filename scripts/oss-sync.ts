#!/usr/bin/env bun
/**
 * OSS Sync Script (TypeScript version)
 *
 * Syncs allowed files from the internal repo to the public OSS repo.
 * Checks for unmerged community contributions before syncing.
 *
 * Usage:
 *   bun run scripts/oss-sync.ts              # Sync to OSS
 *   bun run scripts/oss-sync.ts --dry-run    # Preview changes
 *   bun run scripts/oss-sync.ts --force      # Skip contribution check
 */

import { $ } from 'bun';
import { parseArgs } from 'util';
import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative } from 'path';

const scriptDir = dirname(new URL(import.meta.url).pathname);
const repoRoot = dirname(scriptDir);
const allowListPath = join(scriptDir, 'oss-allow-list.txt');

const DEFAULT_TARGET = 'git@github.com:lukilabs/craft-agents-oss.git';

// Colors for console output
const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
};

interface SyncOptions {
  target: string;
  branch: string;
  dryRun: boolean;
  autoConfirm: boolean;
  force: boolean;
}

function showHelp(): void {
  console.log(`
OSS Sync Script

Usage:
  bun run scripts/oss-sync.ts [options]

Options:
  --target <url>   Target repository URL (default: ${DEFAULT_TARGET})
  --branch <name>  Target branch (default: main)
  --dry-run        Show what would be synced without pushing
  --yes, -y        Auto-confirm push (for CI)
  --force          Skip unmerged contribution check
  --help           Show this help message
`);
}

/**
 * Read and parse the allow-list file
 */
function readAllowList(): string[] {
  const content = readFileSync(allowListPath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Check if a file matches any pattern in the allow-list
 */
function matchesPattern(file: string, pattern: string): boolean {
  // Handle ** glob patterns
  if (pattern.endsWith('/**/*') || pattern.endsWith('/**')) {
    const base = pattern.replace(/\/\*\*\/?\*?$/, '');
    return file.startsWith(base + '/');
  }

  // Exact match
  return file === pattern;
}

/**
 * Get all git-tracked files in the repo
 */
async function getGitFiles(): Promise<string[]> {
  const result = await $`cd ${repoRoot} && git ls-files`.text();
  return result.trim().split('\n').filter(Boolean);
}

/**
 * Filter files by allow-list
 */
function filterFilesByAllowList(files: string[], patterns: string[]): { allowed: string[]; excluded: string[] } {
  const allowed: string[] = [];
  const excluded: string[] = [];

  for (const file of files) {
    const matches = patterns.some((pattern) => matchesPattern(file, pattern));
    if (matches) {
      allowed.push(file);
    } else {
      excluded.push(file);
    }
  }

  return { allowed, excluded };
}

/**
 * Check if a commit's changes are already applied in the internal repo
 */
async function checkPatchAlreadyApplied(commitHash: string, ossDir: string): Promise<boolean> {
  try {
    // Try applying the patch in reverse - if it succeeds, changes are already in target
    await $`cd ${ossDir} && git format-patch -1 --stdout ${commitHash} | git -C ${repoRoot} apply --check --reverse`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for unmerged OSS contributions
 */
async function checkOssContributions(ossDir: string): Promise<boolean> {
  // Add internal repo as remote
  try {
    await $`cd ${ossDir} && git remote add internal ${repoRoot}`.quiet().nothrow();
    await $`cd ${ossDir} && git fetch internal`.quiet();
  } catch {
    // Remote might already exist
  }

  // Get cherry-mark output comparing OSS main with internal main
  let cherryOutput: string;
  try {
    cherryOutput = await $`cd ${ossDir} && git log --cherry-mark --right-only --no-merges --oneline internal/main...main`.text();
  } catch {
    return true; // No unique commits, OK to proceed
  }

  if (!cherryOutput.trim()) {
    return true; // No unique commits
  }

  const needsSync: string[] = [];
  const alreadySynced: string[] = [];
  const needsReview: string[] = [];

  for (const line of cherryOutput.trim().split('\n')) {
    if (!line) continue;

    const mark = line[0];
    const rest = line.slice(2);
    const [hash, ...subjectParts] = rest.split(' ');
    const subject = subjectParts.join(' ');

    // Skip sync commits
    if (subject.includes('Sync from internal repository') || subject === 'Initial commit') {
      continue;
    }

    if (mark === '=') {
      // Git detected this as cherry-picked
      alreadySynced.push(`${hash} ${subject} (cherry-picked by Git)`);
    } else if (mark === '>') {
      // Commit only in OSS - check if changes are already applied
      if (await checkPatchAlreadyApplied(hash, ossDir)) {
        alreadySynced.push(`${hash} ${subject} (changes already applied)`);
      } else {
        // Check if it would apply cleanly
        try {
          await $`cd ${ossDir} && git format-patch -1 --stdout ${hash} | git -C ${repoRoot} apply --check`.quiet();
          needsSync.push(`${hash} ${subject}`);
        } catch {
          needsReview.push(`${hash} ${subject} (conflicts detected)`);
        }
      }
    }
  }

  // Display results
  if (alreadySynced.length > 0) {
    console.log('');
    console.log(colors.green(`✅ Already Synced (${alreadySynced.length} commits):`));
    for (const item of alreadySynced) {
      console.log(`  = ${item}`);
    }
  }

  if (needsSync.length === 0 && needsReview.length === 0) {
    return true; // Nothing needs syncing
  }

  // Report commits that need attention
  console.log('');
  console.log(colors.red('════════════════════════════════════════════════════════════════'));
  console.log(colors.red('ERROR: Unmerged OSS contributions detected!'));
  console.log(colors.red('════════════════════════════════════════════════════════════════'));

  if (needsSync.length > 0) {
    console.log('');
    console.log(colors.yellow(`⚠️  Needs Sync (${needsSync.length} commits):`));
    for (const item of needsSync) {
      console.log(`  > ${item}`);
    }
  }

  if (needsReview.length > 0) {
    console.log('');
    console.log(colors.yellow(`❓ Needs Review (${needsReview.length} commits - conflicts detected):`));
    for (const item of needsReview) {
      console.log(`  > ${item}`);
    }
  }

  console.log('');
  console.log(colors.yellow('To merge these contributions:'));
  console.log('');
  console.log('  1. Add the OSS repo as a remote (one-time setup):');
  console.log('     git remote add oss https://github.com/lukilabs/craft-agents-oss.git');
  console.log('');
  console.log('  2. Fetch the latest from OSS:');
  console.log('     git fetch oss');
  console.log('');
  console.log('  3. Cherry-pick each contribution commit:');
  for (const item of [...needsSync, ...needsReview]) {
    const hash = item.split(' ')[0];
    console.log(`     git cherry-pick ${hash}`);
  }
  console.log('');
  console.log("  4. Resolve any conflicts for commits marked 'needs review'");
  console.log('');
  console.log('  5. Push to internal repo:');
  console.log('     git push origin main');
  console.log('');
  console.log('  6. Re-run the sync workflow');
  console.log('');
  console.log(colors.yellow(`Summary: ${needsSync.length} ready to sync, ${needsReview.length} need review, ${alreadySynced.length} already synced`));
  console.log(colors.red('════════════════════════════════════════════════════════════════'));

  return false;
}

/**
 * Recursively remove empty directories
 */
function removeEmptyDirs(dir: string): void {
  if (!existsSync(dir)) return;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      removeEmptyDirs(fullPath);
    }
  }

  // Check again after potentially removing subdirectories
  if (readdirSync(dir).length === 0) {
    rmSync(dir);
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      target: { type: 'string', default: DEFAULT_TARGET },
      branch: { type: 'string', default: 'main' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  const options: SyncOptions = {
    target: values.target as string,
    branch: values.branch as string,
    dryRun: values['dry-run'] ?? false,
    autoConfirm: values.yes ?? false,
    force: values.force ?? false,
  };

  console.log(colors.green('OSS Sync Script'));
  console.log(`Source: ${repoRoot}`);
  console.log(`Target: ${options.target}`);
  console.log(`Branch: ${options.branch}`);
  console.log('');

  // Get all git-tracked files
  const allFiles = await getGitFiles();
  const patterns = readAllowList();
  const { allowed: allowedFiles, excluded: excludedFiles } = filterFilesByAllowList(allFiles, patterns);

  console.log(colors.green(`Files to sync: ${allowedFiles.length}`));
  console.log(colors.yellow(`Files excluded: ${excludedFiles.length}`));
  console.log('');

  if (options.dryRun) {
    console.log(colors.yellow('=== DRY RUN ==='));
    console.log('');
    console.log('Files that WOULD be synced:');
    for (const file of allowedFiles.slice(0, 50)) {
      console.log(`  ${file}`);
    }
    if (allowedFiles.length > 50) {
      console.log(`  ... and ${allowedFiles.length - 50} more`);
    }
    console.log('');
    console.log('Files that are EXCLUDED:');
    for (const file of excludedFiles) {
      console.log(`  ${file}`);
    }
    return;
  }

  // Create temp directory
  const tempDir = join(repoRoot, '.oss-sync-temp');
  mkdirSync(tempDir, { recursive: true });

  try {
    // Clone target repo
    console.log('Cloning target repository...');
    const targetDir = join(tempDir, 'target');

    try {
      await $`git clone --branch=${options.branch} ${options.target} ${targetDir}`.quiet();
    } catch {
      await $`git clone ${options.target} ${targetDir}`.quiet();
    }

    // Check for unmerged contributions
    if (options.force) {
      console.log(colors.yellow('Skipping contribution check (--force)'));
    } else {
      console.log('Checking for unmerged OSS contributions...');
      const canProceed = await checkOssContributions(targetDir);
      if (!canProceed) {
        process.exit(1);
      }
      console.log(colors.green('No unmerged contributions found.'));
    }

    // Clean managed files in target
    console.log('Cleaning managed files in target...');
    for (const file of allowedFiles) {
      const targetFile = join(targetDir, file);
      if (existsSync(targetFile)) {
        rmSync(targetFile, { force: true });
      }
    }

    // Remove directories that would be fully replaced
    for (const pattern of patterns) {
      if (pattern.endsWith('/**/*') || pattern.endsWith('/**')) {
        const base = pattern.replace(/\/\*\*\/?\*?$/, '');
        const targetSubDir = join(targetDir, base);
        if (existsSync(targetSubDir)) {
          rmSync(targetSubDir, { recursive: true, force: true });
        }
      }
    }

    // Copy allowed files
    console.log('Copying allowed files...');
    for (const file of allowedFiles) {
      const srcPath = join(repoRoot, file);
      const destPath = join(targetDir, file);
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath);
    }

    // Rename README_FOR_OSS.md to README.md
    const ossReadme = join(targetDir, 'README_FOR_OSS.md');
    const readme = join(targetDir, 'README.md');
    if (existsSync(ossReadme)) {
      const content = readFileSync(ossReadme, 'utf-8');
      Bun.write(readme, content);
      rmSync(ossReadme);
      console.log('Renamed README_FOR_OSS.md → README.md');
    }

    // Show diff
    console.log('');
    console.log(colors.green('=== Changes ==='));
    await $`cd ${targetDir} && git status --short`;

    // Confirm push
    console.log('');
    let shouldPush = options.autoConfirm;
    if (!shouldPush) {
      process.stdout.write(`Push these changes to ${options.target}? [y/N] `);
      for await (const line of console) {
        shouldPush = line.toLowerCase().startsWith('y');
        break;
      }
    }

    if (shouldPush) {
      await $`cd ${targetDir} && git add -A`;

      const commitDate = new Date().toISOString();
      const commitResult = await $`cd ${targetDir} && git commit -m ${"Sync from internal repository\n\nSynced " + commitDate}`.nothrow();

      if (commitResult.exitCode !== 0) {
        console.log(colors.yellow('Nothing to commit - already in sync'));
        return;
      }

      await $`cd ${targetDir} && git push origin ${options.branch}`;
      console.log(colors.green('Sync complete!'));
    } else {
      console.log('Aborted.');
      process.exit(1);
    }
  } finally {
    // Cleanup temp directory
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
