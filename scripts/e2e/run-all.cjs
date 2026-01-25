#!/usr/bin/env node
/**
 * E2E Test Runner - All Tests
 *
 * Runs all E2E tests for recent Vespr features in sequence.
 *
 * Prerequisites:
 *   1. Start Electron with remote debugging:
 *      VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *
 *   2. Run this script:
 *      node scripts/e2e/run-all.cjs
 *
 * Options:
 *   --test=<name>  Run specific test (e.g., --test=skills-marketplace)
 *   --parallel     Run tests in parallel (faster but may interfere with each other)
 */

const { spawn } = require('child_process');
const path = require('path');
const { setupTestWorkspace } = require('./setup-test-workspace.cjs');

// Available test suites
const TEST_SUITES = [
  { name: 'skills-marketplace', file: 'skills-marketplace.e2e.cjs' },
  { name: 'terminal-resume', file: 'terminal-resume.e2e.cjs' },
  { name: 'session-labels', file: 'session-labels.e2e.cjs' },
  { name: 'scheduler-continuation', file: 'scheduler-continuation.e2e.cjs' },
  { name: 'viewer-backend', file: 'viewer-backend.e2e.cjs' },
  { name: 'whatsapp-integration', file: 'whatsapp-integration.e2e.cjs' },
];

// Parse command line arguments
const args = process.argv.slice(2);
const specificTest = args.find(arg => arg.startsWith('--test='))?.split('=')[1];
const runParallel = args.includes('--parallel');

function log(msg) {
  console.log(`[E2E-RUNNER] ${msg}`);
}

function runTest(suite) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, suite.file);

    log(`Starting: ${suite.name}`);

    const child = spawn('node', [testPath], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      resolve({
        name: suite.name,
        exitCode: code,
        passed: code === 0,
      });
    });

    child.on('error', (error) => {
      log(`Error running ${suite.name}: ${error.message}`);
      resolve({
        name: suite.name,
        exitCode: 1,
        passed: false,
        error: error.message,
      });
    });
  });
}

async function runSequential(suites) {
  const results = [];
  for (const suite of suites) {
    const result = await runTest(suite);
    results.push(result);

    // Small delay between tests to let the app settle
    await new Promise(r => setTimeout(r, 1000));
  }
  return results;
}

async function runParallelTests(suites) {
  return Promise.all(suites.map(suite => runTest(suite)));
}

async function main() {
  log('');
  log('========================================');
  log('VESPR E2E TEST RUNNER');
  log('========================================');
  log('');

  // Determine which tests to run
  let suitesToRun = TEST_SUITES;
  if (specificTest) {
    const found = TEST_SUITES.find(s => s.name === specificTest);
    if (!found) {
      log(`Unknown test: ${specificTest}`);
      log(`Available tests: ${TEST_SUITES.map(s => s.name).join(', ')}`);
      process.exit(1);
    }
    suitesToRun = [found];
  }

  log(`Running ${suitesToRun.length} test suite(s)${runParallel ? ' in parallel' : ''}`);
  log('');

  // Check if Electron is running with CDP
  try {
    const response = await fetch('http://localhost:9222/json');
    if (!response.ok) throw new Error('CDP not available');
    log('CDP endpoint available at localhost:9222');
  } catch (error) {
    log('');
    log('ERROR: Cannot connect to CDP endpoint');
    log('');
    log('Please start Electron with remote debugging:');
    log('  VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron');
    log('');
    process.exit(1);
  }

  log('');

  // Setup test workspace
  log('Setting up test workspace...');
  try {
    const setupResult = await setupTestWorkspace();
    if (setupResult.created) {
      log(`Created test workspace: ${setupResult.workspaceId.slice(0, 8)}...`);
    } else {
      log(`Using existing workspace: ${setupResult.workspaceId.slice(0, 8)}...`);
    }
  } catch (error) {
    log(`Warning: Could not setup test workspace: ${error.message}`);
    log('Tests requiring a workspace may be skipped.');
  }
  log('');

  // Run tests
  const startTime = Date.now();
  const results = runParallel
    ? await runParallelTests(suitesToRun)
    : await runSequential(suitesToRun);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  // Print summary
  log('');
  log('========================================');
  log('SUMMARY');
  log('========================================');
  log('');
  log(`Duration: ${duration}s`);
  log('');

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  log(`Total: ${results.length} suites`);
  log(`Passed: ${passed.length}`);
  log(`Failed: ${failed.length}`);
  log('');

  if (passed.length > 0) {
    log('PASSED:');
    passed.forEach(r => log(`  ✅ ${r.name}`));
  }

  if (failed.length > 0) {
    log('');
    log('FAILED:');
    failed.forEach(r => log(`  ❌ ${r.name}${r.error ? `: ${r.error}` : ''}`));
  }

  log('');
  log('========================================');

  // Screenshots location
  log('');
  log('Screenshots saved to: /tmp/vespr-e2e/');

  // Exit with appropriate code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
