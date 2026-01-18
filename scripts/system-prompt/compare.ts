#!/usr/bin/env bun
/**
 * Compare two versions of the Claude Code system prompt.
 *
 * Uses git diff for colored diff output. If no versions are specified,
 * compares the two most recent versions found in prompts/claude-code/.
 *
 * Usage:
 *   bun run scripts/system-prompt/compare.ts [version1] [version2]
 *
 * Examples:
 *   bun run scripts/system-prompt/compare.ts v0.1.62 v0.1.73
 *   bun run scripts/system-prompt/compare.ts  # compares two most recent
 */

import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROMPTS_DIR = join(process.cwd(), 'prompts/claude-code');

/**
 * Get all version files sorted by semver (newest first)
 */
function getVersionFiles(): { version: string; path: string }[] {
  if (!existsSync(PROMPTS_DIR)) {
    return [];
  }

  const files = readdirSync(PROMPTS_DIR)
    .filter((f) => f.match(/^v\d+\.\d+\.\d+\.md$/))
    .map((f) => ({
      version: f.replace('.md', ''),
      path: join(PROMPTS_DIR, f),
    }));

  // Sort by semver descending
  files.sort((a, b) => {
    const va = a.version.slice(1).split('.').map(Number);
    const vb = b.version.slice(1).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (va[i] !== vb[i]) return vb[i] - va[i];
    }
    return 0;
  });

  return files;
}

/**
 * Find file path for a version
 */
function findVersionFile(version: string): string | null {
  // Normalize: accept both "0.1.62" and "v0.1.62"
  const normalized = version.startsWith('v') ? version : `v${version}`;
  const path = join(PROMPTS_DIR, `${normalized}.md`);
  return existsSync(path) ? path : null;
}

function main() {
  const args = process.argv.slice(2);

  let file1: string | null = null;
  let file2: string | null = null;
  let version1 = '';
  let version2 = '';

  if (args.length >= 2) {
    // Explicit versions provided
    version1 = args[0];
    version2 = args[1];
    file1 = findVersionFile(version1);
    file2 = findVersionFile(version2);

    if (!file1) {
      console.error(`✗ Version ${version1} not found`);
      console.error(`  Expected: ${join(PROMPTS_DIR, `v${version1.replace('v', '')}.md`)}`);
      process.exit(1);
    }
    if (!file2) {
      console.error(`✗ Version ${version2} not found`);
      console.error(`  Expected: ${join(PROMPTS_DIR, `v${version2.replace('v', '')}.md`)}`);
      process.exit(1);
    }
  } else {
    // Auto-detect two most recent versions
    const versions = getVersionFiles();

    if (versions.length < 2) {
      console.error('✗ Need at least 2 version files to compare');
      console.error('  Run extract.ts to capture more versions.');
      if (versions.length === 1) {
        console.error(`  Found: ${versions[0].version}`);
      }
      process.exit(1);
    }

    version1 = versions[1].version;  // Older
    version2 = versions[0].version;  // Newer
    file1 = versions[1].path;
    file2 = versions[0].path;

    console.log(`Auto-detected versions: ${version1} → ${version2}\n`);
  }

  console.log(`Comparing: ${version1} → ${version2}\n`);
  console.log('─'.repeat(60));

  // Use git diff for colored output
  const result = spawnSync('git', [
    'diff',
    '--no-index',
    '--color=always',
    '--word-diff=color',
    file1,
    file2,
  ], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (result.stdout) {
    // Replace file paths with version names for cleaner output
    let output = result.stdout
      .replace(new RegExp(file1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), version1)
      .replace(new RegExp(file2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), version2);
    console.log(output);
  }

  if (result.stderr) {
    console.error(result.stderr);
  }

  // git diff returns 1 if files differ, 0 if same
  if (result.status === 0) {
    console.log('✓ Files are identical');
  } else if (result.status === 1) {
    // Normal - files differ
    console.log('\n' + '─'.repeat(60));
    console.log('✓ Diff complete');
  } else {
    console.error(`\n✗ git diff failed with status ${result.status}`);
    process.exit(1);
  }
}

main();
