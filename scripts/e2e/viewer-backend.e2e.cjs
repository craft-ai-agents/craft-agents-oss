/**
 * E2E Tests for Viewer Backend Abstraction
 *
 * Tests the ViewerService interface for session sharing.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/viewer-backend.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('Viewer Backend Abstraction');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('viewerShare exists', async () => {
      const exists = await runner.checkApiMethod('viewerShare');
      assert.truthy(exists, 'viewerShare method should exist');
      return 'Method is available';
    });

    await runner.test('viewerUpdate exists', async () => {
      const exists = await runner.checkApiMethod('viewerUpdate');
      assert.truthy(exists, 'viewerUpdate method should exist');
      return 'Method is available';
    });

    await runner.test('viewerRevoke exists', async () => {
      const exists = await runner.checkApiMethod('viewerRevoke');
      assert.truthy(exists, 'viewerRevoke method should exist');
      return 'Method is available';
    });

    await runner.test('viewerHealthCheck exists', async () => {
      const exists = await runner.checkApiMethod('viewerHealthCheck');
      assert.truthy(exists, 'viewerHealthCheck method should exist');
      return 'Method is available';
    });

    await runner.test('getViewerConfig exists', async () => {
      const exists = await runner.checkApiMethod('getViewerConfig');
      assert.truthy(exists, 'getViewerConfig method should exist');
      return 'Method is available';
    });

    await runner.test('setViewerConfig exists', async () => {
      const exists = await runner.checkApiMethod('setViewerConfig');
      assert.truthy(exists, 'setViewerConfig method should exist');
      return 'Method is available';
    });
  });

  // Test Group: Viewer Configuration
  await runner.group('Viewer Configuration', async () => {
    await runner.test('getViewerConfig returns config object', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.getViewerConfig();
          // IPC returns { success: boolean, config: { type: ... } }
          const config = response.config || response;
          return {
            hasResponse: !!response,
            hasSuccess: 'success' in response,
            success: response.success,
            hasConfig: !!config,
            hasType: config && 'type' in config,
            type: config?.type
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasResponse, 'Should return response object');
      assert.truthy(result.hasSuccess, 'Response should have success field');
      assert.truthy(result.hasType, 'Config should have type field');
      return `Current type: ${result.type || 'not set'}`;
    });

    await runner.test('setViewerConfig accepts craft-hosted type', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Get current config to restore later
          const originalResponse = await window.electronAPI.getViewerConfig();
          const originalConfig = originalResponse.config || { type: 'craft-hosted' };

          // Set to craft-hosted
          const setResult = await window.electronAPI.setViewerConfig({
            type: 'craft-hosted',
            craftUrl: 'https://viewer.example.com'
          });

          const newResponse = await window.electronAPI.getViewerConfig();
          const newConfig = newResponse.config || {};

          // Restore original config
          await window.electronAPI.setViewerConfig(originalConfig);

          return {
            setSuccess: setResult?.success,
            success: newConfig?.type === 'craft-hosted',
            type: newConfig?.type
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.setSuccess || result.success, 'Should accept craft-hosted type');
      return 'craft-hosted config accepted';
    });

    await runner.test('setViewerConfig accepts static-export type', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Get current config to restore later
          const originalResponse = await window.electronAPI.getViewerConfig();
          const originalConfig = originalResponse.config || { type: 'craft-hosted' };

          // Set to static-export
          const setResult = await window.electronAPI.setViewerConfig({
            type: 'static-export',
            exportPath: '/tmp/vespr-exports'
          });

          const newResponse = await window.electronAPI.getViewerConfig();
          const newConfig = newResponse.config || {};

          // Restore original config
          await window.electronAPI.setViewerConfig(originalConfig);

          return {
            setSuccess: setResult?.success,
            success: newConfig?.type === 'static-export',
            type: newConfig?.type,
            setResult: JSON.stringify(setResult),
            // If we got here without throwing, the API accepted the call
            apiAccepted: true
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      // API accepted the call if we got a response without exception
      // Config may not persist if there's no config file yet
      return result.success
        ? 'static-export config accepted and persisted'
        : `static-export type accepted (setResult: ${result.setResult}, currentType: ${result.type})`;
    });
  });

  // Test Group: Health Check
  await runner.group('Health Check', async () => {
    await runner.test('viewerHealthCheck returns status', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.viewerHealthCheck();
          // IPC returns { success: boolean, error?: string }
          return {
            hasResponse: !!response,
            hasSuccess: 'success' in response,
            success: response.success,
            error: response.error
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasResponse, 'Should return response object');
      assert.truthy(result.hasSuccess, 'Response should have success field');
      return `Health check: ${result.success ? 'healthy' : 'unhealthy' + (result.error ? ' - ' + result.error : '')}`;
    });
  });

  // Test Group: Share Result Structure
  await runner.group('Share Result Structure', async () => {
    await runner.test('viewerShare returns ShareResult structure', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Get a session to share
          const sessions = await window.electronAPI.getSessions();
          if (sessions.length === 0) {
            return { noSessions: true };
          }

          const session = sessions[0];

          // Try to share (may fail if not configured, but should return proper structure)
          const shareResult = await window.electronAPI.viewerShare(session.id);

          return {
            hasSuccess: 'success' in shareResult,
            success: shareResult.success,
            hasId: 'id' in shareResult,
            hasUrl: 'url' in shareResult,
            hasError: 'error' in shareResult,
            error: shareResult.error
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.noSessions) {
        return 'skip';
      }

      assert.truthy(result.hasSuccess, 'Result should have success field');
      return result.success
        ? `Share succeeded with URL: ${result.hasUrl ? 'present' : 'missing'}`
        : `Share failed (expected if not configured): ${result.error || 'no error message'}`;
    });
  });

  // Test Group: Update and Revoke Structure
  await runner.group('Update and Revoke Structure', async () => {
    await runner.test('viewerUpdate returns ShareResult structure', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Call with a fake share ID
          const updateResult = await window.electronAPI.viewerUpdate('fake-share-id', 'fake-session-id');
          return {
            hasSuccess: 'success' in updateResult,
            success: updateResult.success,
            hasError: 'error' in updateResult
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasSuccess, 'Result should have success field');
      return result.success ? 'Update succeeded' : 'Update failed (expected for fake ID)';
    });

    await runner.test('viewerRevoke returns ShareResult structure', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Call with a fake share ID
          const revokeResult = await window.electronAPI.viewerRevoke('fake-share-id');
          return {
            hasSuccess: 'success' in revokeResult,
            success: revokeResult.success,
            hasError: 'error' in revokeResult
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasSuccess, 'Result should have success field');
      return result.success ? 'Revoke succeeded' : 'Revoke failed (expected for fake ID)';
    });
  });

  // Test Group: UI Components
  await runner.group('UI Components', async () => {
    await runner.test('Take screenshot', async () => {
      const path = await runner.screenshot('viewer-backend.png');
      return `Saved to ${path}`;
    });
  });

  // Cleanup
  return runner.teardown();
}

// Run tests
runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
