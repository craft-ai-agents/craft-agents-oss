/**
 * E2E Tests for Session Labels
 *
 * Tests the label creation, editing, deletion, and UI components.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/session-labels.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('Session Labels');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('getLabels exists', async () => {
      const exists = await runner.checkApiMethod('getLabels');
      assert.truthy(exists, 'getLabels method should exist');
      return 'Method is available';
    });

    await runner.test('createLabel exists', async () => {
      const exists = await runner.checkApiMethod('createLabel');
      assert.truthy(exists, 'createLabel method should exist');
      return 'Method is available';
    });

    await runner.test('updateLabel exists', async () => {
      const exists = await runner.checkApiMethod('updateLabel');
      assert.truthy(exists, 'updateLabel method should exist');
      return 'Method is available';
    });

    await runner.test('deleteLabel exists', async () => {
      const exists = await runner.checkApiMethod('deleteLabel');
      assert.truthy(exists, 'deleteLabel method should exist');
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

  // Test Group: Label CRUD Operations
  await runner.group('Label CRUD Operations', async () => {
    let testLabelId = null;
    const testLabelName = `E2E Test Label ${Date.now()}`;
    const testLabelColor = '#ef4444'; // Red

    await runner.test('getLabels returns array', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const labels = await window.electronAPI.getLabels('${workspaceId}');
          return {
            isArray: Array.isArray(labels),
            count: labels ? labels.length : 0
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.isArray, 'getLabels should return an array');
      return `Found ${result.count} existing labels`;
    });

    await runner.test('createLabel creates new label', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const label = await window.electronAPI.createLabel(
            '${workspaceId}',
            '${testLabelName}',
            '${testLabelColor}'
          );
          return {
            success: !!label,
            id: label?.id,
            name: label?.name,
            color: label?.color
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.success, 'Should create label');
      assert.equal(result.name, testLabelName, 'Label name should match');
      assert.equal(result.color, testLabelColor, 'Label color should match');

      testLabelId = result.id;
      return `Created label with ID: ${testLabelId}`;
    });

    await runner.test('getLabels includes new label', async () => {
      if (!testLabelId) {
        return 'skip';
      }

      const result = await runner.evaluate(`(async () => {
        const labels = await window.electronAPI.getLabels('${workspaceId}');
        const found = labels.find(l => l.id === '${testLabelId}');
        return {
          found: !!found,
          name: found?.name
        };
      })()`, { awaitPromise: true });

      assert.truthy(result.found, 'New label should be in list');
      assert.equal(result.name, testLabelName, 'Label name should match');
      return 'Label found in list';
    });

    await runner.test('updateLabel modifies label', async () => {
      if (!testLabelId) {
        return 'skip';
      }

      const updatedName = `${testLabelName} Updated`;
      const updatedColor = '#3b82f6'; // Blue

      const result = await runner.evaluate(`(async () => {
        try {
          const label = await window.electronAPI.updateLabel(
            '${workspaceId}',
            '${testLabelId}',
            { name: '${updatedName}', color: '${updatedColor}' }
          );
          return {
            success: !!label,
            name: label?.name,
            color: label?.color
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.equal(result.name, updatedName, 'Name should be updated');
      assert.equal(result.color, updatedColor, 'Color should be updated');
      return 'Label updated successfully';
    });

    await runner.test('deleteLabel removes label', async () => {
      if (!testLabelId) {
        return 'skip';
      }

      const result = await runner.evaluate(`(async () => {
        try {
          await window.electronAPI.deleteLabel('${workspaceId}', '${testLabelId}');
          const labels = await window.electronAPI.getLabels('${workspaceId}');
          const found = labels.find(l => l.id === '${testLabelId}');
          return { deleted: !found };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.deleted, 'Label should be deleted');
      return 'Label deleted successfully';
    });
  });

  // Test Group: Label Color Validation
  await runner.group('Label Color Validation', async () => {
    await runner.test('Label supports all 8 preset colors', async () => {
      const colors = [
        '#ef4444', // Red
        '#f97316', // Orange
        '#eab308', // Yellow
        '#22c55e', // Green
        '#14b8a6', // Teal
        '#3b82f6', // Blue
        '#a855f7', // Purple
        '#ec4899', // Pink
      ];

      const result = await runner.evaluate(`(async () => {
        const colors = ${JSON.stringify(colors)};
        const results = [];

        for (const color of colors) {
          try {
            const label = await window.electronAPI.createLabel(
              '${workspaceId}',
              'Color Test ' + color,
              color
            );
            if (label) {
              await window.electronAPI.deleteLabel('${workspaceId}', label.id);
              results.push({ color, success: true });
            }
          } catch (e) {
            results.push({ color, success: false, error: e.message });
          }
        }

        return {
          allSuccess: results.every(r => r.success),
          results
        };
      })()`, { awaitPromise: true });

      assert.truthy(result.allSuccess, 'All colors should be valid');
      return 'All 8 preset colors accepted';
    });
  });

  // Test Group: UI Components
  await runner.group('UI Components', async () => {
    await runner.test('Navigate to labels settings', async () => {
      await runner.navigateTo('#/settings');
      await runner.wait(1000);

      // Look for labels section in settings
      const hasLabelsSection = await runner.evaluate(`(() => {
        const text = document.body.innerText;
        return text.includes('Labels') || text.includes('labels');
      })()`);

      return hasLabelsSection ? 'Labels section found' : 'Labels section not visible (may need scrolling)';
    });

    await runner.test('Take screenshot of settings page', async () => {
      const path = await runner.screenshot('session-labels-settings.png');
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
