#!/usr/bin/env bun
/**
 * Fresh Start Script
 *
 * Removes the .craft-agent folder to simulate a fresh start.
 * Works cross-platform (macOS, Linux, Windows).
 */

import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { homedir } from 'os';

// ANSI color codes
const colors = {
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(message: string, color?: keyof typeof colors) {
  const colorCode = color ? colors[color] : '';
  console.log(`${colorCode}${message}${colors.reset}`);
}

async function promptConfirmation(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Are you sure you want to continue? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes');
    });
  });
}

async function main() {
  // Detect config directory (respects multi-instance setup)
  const configDir = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent');

  log('\n' + '='.repeat(60), 'yellow');
  log('FRESH START - Remove Craft Agent Data', 'bold');
  log('='.repeat(60) + '\n', 'yellow');

  log('This will remove all Craft Agent data at:', 'yellow');
  log(`  ${configDir}`, 'yellow');
  log('');
  log('This includes:');
  log('  • All workspaces and sessions');
  log('  • All sources and skills');
  log('  • Configuration and credentials');
  log('  • Preferences and themes');
  log('');

  // Check if directory exists
  if (!existsSync(configDir)) {
    log('✓ Directory does not exist. Nothing to remove.', 'green');
    log('✓ Ready for fresh start', 'green');
    process.exit(0);
  }

  // Prompt for confirmation
  const confirmed = await promptConfirmation();

  if (!confirmed) {
    log('\nAborted.', 'red');
    process.exit(1);
  }

  // Remove the directory
  log(`\nRemoving ${configDir}...`, 'yellow');

  try {
    rmSync(configDir, { recursive: true, force: true });
    log('\n✓ Successfully removed Craft Agent data', 'green');
    log('✓ Ready for fresh start', 'green');
    log('');
  } catch (error) {
    log('\n✗ Error removing directory:', 'red');
    console.error(error);
    process.exit(1);
  }
}

main();
