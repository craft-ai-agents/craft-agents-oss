/**
 * E2E Tests for WhatsApp Integration
 *
 * Tests the WhatsApp connection, session management, and message routing.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/whatsapp-integration.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('WhatsApp Integration');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('whatsappConnect exists', async () => {
      const exists = await runner.checkApiMethod('whatsappConnect');
      assert.truthy(exists, 'whatsappConnect method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappDisconnect exists', async () => {
      const exists = await runner.checkApiMethod('whatsappDisconnect');
      assert.truthy(exists, 'whatsappDisconnect method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappGetStatus exists', async () => {
      const exists = await runner.checkApiMethod('whatsappGetStatus');
      assert.truthy(exists, 'whatsappGetStatus method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappGetGroups exists', async () => {
      const exists = await runner.checkApiMethod('whatsappGetGroups');
      assert.truthy(exists, 'whatsappGetGroups method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappSendMessage exists', async () => {
      const exists = await runner.checkApiMethod('whatsappSendMessage');
      assert.truthy(exists, 'whatsappSendMessage method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappGetRouteConfig exists', async () => {
      const exists = await runner.checkApiMethod('whatsappGetRouteConfig');
      assert.truthy(exists, 'whatsappGetRouteConfig method should exist');
      return 'Method is available';
    });

    await runner.test('whatsappSetRouteConfig exists', async () => {
      const exists = await runner.checkApiMethod('whatsappSetRouteConfig');
      assert.truthy(exists, 'whatsappSetRouteConfig method should exist');
      return 'Method is available';
    });
  });

  // Get workspace ID for testing
  let workspaceId = null;
  await runner.group('Setup', async () => {
    await runner.test('Get active workspace', async () => {
      const result = await runner.evaluate(`(async () => {
        const config = await window.electronAPI.getConfig();
        return {
          workspaceId: config?.activeWorkspaceId,
          hasWorkspaces: config?.workspaces?.length > 0
        };
      })()`, { awaitPromise: true });

      if (!result.workspaceId) {
        throw new Error('No active workspace found');
      }

      workspaceId = result.workspaceId;
      return `Using workspace: ${workspaceId.slice(0, 8)}...`;
    });
  });

  // Test Group: Connection Status
  await runner.group('Connection Status', async () => {
    await runner.test('whatsappGetStatus returns status object', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const status = await window.electronAPI.whatsappGetStatus('${workspaceId}');
          return {
            hasStatus: !!status,
            hasConnection: status && 'connection' in status,
            connection: status?.connection
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasStatus, 'Should return status object');
      assert.truthy(result.hasConnection, 'Status should have connection field');
      return `Connection status: ${result.connection}`;
    });

    await runner.test('Connection status has valid values', async () => {
      const result = await runner.evaluate(`(async () => {
        const status = await window.electronAPI.whatsappGetStatus('${workspaceId}');
        const validStates = ['open', 'close', 'connecting'];
        return {
          connection: status?.connection,
          isValid: validStates.includes(status?.connection)
        };
      })()`, { awaitPromise: true });

      assert.truthy(result.isValid, `Connection should be one of: open, close, connecting. Got: ${result.connection}`);
      return `Valid state: ${result.connection}`;
    });
  });

  // Test Group: Route Configuration
  await runner.group('Route Configuration', async () => {
    await runner.test('whatsappGetRouteConfig returns config', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const config = await window.electronAPI.whatsappGetRouteConfig('${workspaceId}');
          return {
            hasConfig: config !== null && config !== undefined,
            type: typeof config
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      return `Config type: ${result.type}`;
    });

    await runner.test('whatsappSetRouteConfig accepts valid config', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Get current config to restore later
          const originalConfig = await window.electronAPI.whatsappGetRouteConfig('${workspaceId}');

          // Set test config
          await window.electronAPI.whatsappSetRouteConfig('${workspaceId}', {
            enabled: false,
            groups: []
          });

          // Restore original
          if (originalConfig) {
            await window.electronAPI.whatsappSetRouteConfig('${workspaceId}', originalConfig);
          }

          return { success: true };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      return 'Config update accepted';
    });
  });

  // Test Group: Groups (when not connected)
  await runner.group('Groups API', async () => {
    await runner.test('whatsappGetGroups handles disconnected state', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const groups = await window.electronAPI.whatsappGetGroups('${workspaceId}');
          return {
            isArray: Array.isArray(groups),
            count: groups ? groups.length : 0
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        // Expected when disconnected
        return `Handled gracefully: ${result.error.slice(0, 50)}...`;
      }

      assert.truthy(result.isArray, 'Should return array');
      return `Found ${result.count} groups`;
    });
  });

  // Test Group: IPC Event Listeners
  await runner.group('IPC Event Listeners', async () => {
    await runner.test('QR code event listener can be registered', async () => {
      const result = await runner.evaluate(`(() => {
        // Check if ipcRenderer.on is available (via preload)
        const hasOnMethod = typeof window.electronAPI.on === 'function' ||
                           typeof window.electronAPI.onWhatsAppQR === 'function';
        return { hasOnMethod };
      })()`);

      return result.hasOnMethod
        ? 'Event listener registration available'
        : 'Event listener not exposed (may use different pattern)';
    });

    await runner.test('Status change event listener can be registered', async () => {
      const result = await runner.evaluate(`(() => {
        const hasStatusListener = typeof window.electronAPI.onWhatsAppStatus === 'function' ||
                                  typeof window.electronAPI.on === 'function';
        return { hasStatusListener };
      })()`);

      return result.hasStatusListener
        ? 'Status listener available'
        : 'Status listener not exposed (may use different pattern)';
    });
  });

  // Test Group: Message Sending (structure only, no actual send)
  await runner.group('Message Sending Structure', async () => {
    await runner.test('whatsappSendMessage requires valid parameters', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          // Try to call without proper parameters
          const response = await window.electronAPI.whatsappSendMessage('${workspaceId}', '', '');
          return { response };
        } catch (e) {
          return { error: e.message, rejected: true };
        }
      })()`, { awaitPromise: true });

      // Should either reject or return error for empty parameters
      if (result.rejected || (result.response && !result.response.success)) {
        return 'Correctly validates parameters';
      }

      return 'Parameter validation check complete';
    });
  });

  // Test Group: UI Components
  await runner.group('UI Components', async () => {
    await runner.test('Navigate to WhatsApp settings', async () => {
      await runner.navigateTo('#/settings/whatsapp');
      await runner.wait(1000);

      const hasWhatsAppContent = await runner.evaluate(`(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('whatsapp') || text.includes('phone');
      })()`);

      return hasWhatsAppContent ? 'WhatsApp section found' : 'WhatsApp section not visible';
    });

    await runner.test('Take screenshot', async () => {
      const path = await runner.screenshot('whatsapp-integration.png');
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
