/**
 * E2E Test Workspace Setup
 *
 * Creates a mock workspace for E2E testing via CDP.
 * This ensures all tests have a valid workspace to operate on.
 */

const { E2ETestRunner } = require('./cdp-utils.cjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TEST_WORKSPACE_NAME = 'E2E Test Workspace';
const TEST_WORKSPACE_DIR = path.join(os.tmpdir(), 'vespr-e2e-workspace');

/**
 * Setup test workspace via CDP
 * @returns {Promise<{workspaceId: string, created: boolean}>}
 */
async function setupTestWorkspace() {
  const runner = new E2ETestRunner('Test Workspace Setup');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    throw new Error('Failed to connect to CDP endpoint');
  }

  try {
    // Check if we already have a workspace
    const existingResult = await runner.evaluate(`(async () => {
      try {
        const config = await window.electronAPI.getConfig();
        return {
          activeWorkspaceId: config?.activeWorkspaceId,
          workspaces: config?.workspaces || [],
          hasWorkspaces: (config?.workspaces?.length || 0) > 0
        };
      } catch (e) {
        return { error: e.message };
      }
    })()`, { awaitPromise: true });

    if (existingResult.error) {
      throw new Error(`Failed to get config: ${existingResult.error}`);
    }

    // If we already have a workspace, use it
    if (existingResult.hasWorkspaces && existingResult.activeWorkspaceId) {
      console.log(`[E2E-SETUP] Using existing workspace: ${existingResult.activeWorkspaceId.slice(0, 8)}...`);
      await runner.disconnect();
      return {
        workspaceId: existingResult.activeWorkspaceId,
        created: false
      };
    }

    // Check for any workspace we can use
    if (existingResult.workspaces.length > 0) {
      const ws = existingResult.workspaces[0];
      console.log(`[E2E-SETUP] Using first available workspace: ${ws.id.slice(0, 8)}...`);
      await runner.disconnect();
      return {
        workspaceId: ws.id,
        created: false
      };
    }

    // Create the test workspace directory if it doesn't exist
    if (!fs.existsSync(TEST_WORKSPACE_DIR)) {
      fs.mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
      console.log(`[E2E-SETUP] Created test directory: ${TEST_WORKSPACE_DIR}`);
    }

    // Create a new workspace
    // First, we need to ensure there's a base config file
    // The app normally creates this during onboarding, but for E2E tests we bootstrap it
    console.log(`[E2E-SETUP] Creating new test workspace...`);

    // First attempt to create workspace
    let createResult = await runner.evaluate(`(async () => {
      try {
        const workspace = await window.electronAPI.createWorkspace(
          '${TEST_WORKSPACE_DIR.replace(/\\/g, '\\\\')}',
          '${TEST_WORKSPACE_NAME}'
        );
        return {
          success: true,
          workspaceId: workspace?.id,
          name: workspace?.name
        };
      } catch (e) {
        return { error: e.message, needsOnboarding: e.message.includes('No config') };
      }
    })()`, { awaitPromise: true });

    // If no config exists, initialize via onboarding API
    if (createResult.error && createResult.needsOnboarding) {
      console.log(`[E2E-SETUP] Initializing config via onboarding API...`);

      const onboardingResult = await runner.evaluate(`(async () => {
        try {
          // Use saveOnboardingConfig to initialize the app with a test workspace
          const result = await window.electronAPI.saveOnboardingConfig({
            authType: 'anthropic_key',
            workspace: {
              name: '${TEST_WORKSPACE_NAME}',
            }
          });
          return result;
        } catch (e) {
          return { success: false, error: e.message };
        }
      })()`, { awaitPromise: true });

      if (onboardingResult.success && onboardingResult.workspaceId) {
        console.log(`[E2E-SETUP] Config initialized with workspace: ${onboardingResult.workspaceId.slice(0, 8)}...`);
        await runner.disconnect();
        return {
          workspaceId: onboardingResult.workspaceId,
          created: true
        };
      }

      // If onboarding also failed, try creating workspace again (config might be initialized now)
      createResult = await runner.evaluate(`(async () => {
        try {
          const workspace = await window.electronAPI.createWorkspace(
            '${TEST_WORKSPACE_DIR.replace(/\\/g, '\\\\')}',
            '${TEST_WORKSPACE_NAME}'
          );
          return {
            success: true,
            workspaceId: workspace?.id,
            name: workspace?.name
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });
    }

    if (createResult.error) {
      console.log(`[E2E-SETUP] Could not create workspace: ${createResult.error}`);
      console.log(`[E2E-SETUP] Tests requiring a workspace will be skipped`);
      throw new Error(`Failed to create workspace: ${createResult.error}`);
    }

    if (!createResult.workspaceId) {
      throw new Error('Workspace creation returned no ID');
    }

    console.log(`[E2E-SETUP] Created workspace: ${createResult.workspaceId.slice(0, 8)}... (${createResult.name})`);

    await runner.disconnect();
    return {
      workspaceId: createResult.workspaceId,
      created: true
    };

  } catch (error) {
    await runner.disconnect();
    throw error;
  }
}

/**
 * Cleanup test workspace artifacts
 * Removes temp directory and test data created during tests
 * Note: Workspace config entry persists (no deleteWorkspace API) - this is fine
 */
async function cleanupTestWorkspace() {
  console.log(`[E2E-CLEANUP] Cleaning up test artifacts...`);

  // Clean up the temp directory
  if (fs.existsSync(TEST_WORKSPACE_DIR)) {
    try {
      fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true });
      console.log(`[E2E-CLEANUP] Removed test directory: ${TEST_WORKSPACE_DIR}`);
    } catch (e) {
      console.log(`[E2E-CLEANUP] Could not remove test directory: ${e.message}`);
    }
  } else {
    console.log(`[E2E-CLEANUP] Test directory already clean`);
  }

  // Clean up test screenshots
  const screenshotDir = '/tmp/vespr-e2e';
  if (fs.existsSync(screenshotDir)) {
    try {
      fs.rmSync(screenshotDir, { recursive: true });
      console.log(`[E2E-CLEANUP] Removed screenshots: ${screenshotDir}`);
    } catch (e) {
      // Ignore errors
    }
  }

  // Note: Workspace entry in ~/.vesper/config.json persists
  // This is intentional - no deleteWorkspace API and entries are minimal
  console.log(`[E2E-CLEANUP] Done (workspace config entry preserved)`);
}

/**
 * Force fresh start by cleaning up before tests
 * Same as cleanup but runs before setup
 */
async function freshStart() {
  console.log(`[E2E-FRESH] Starting fresh - removing previous test artifacts...`);
  await cleanupTestWorkspace();
}

// Export for use by run-all.cjs
module.exports = {
  setupTestWorkspace,
  cleanupTestWorkspace,
  freshStart,
  TEST_WORKSPACE_NAME,
  TEST_WORKSPACE_DIR
};

// Run standalone if called directly
if (require.main === module) {
  setupTestWorkspace()
    .then(result => {
      console.log(`[E2E-SETUP] Setup complete:`, result);
      process.exit(0);
    })
    .catch(error => {
      console.error(`[E2E-SETUP] Setup failed:`, error.message);
      process.exit(1);
    });
}
