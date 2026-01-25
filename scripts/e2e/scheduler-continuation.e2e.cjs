/**
 * E2E Tests for Scheduler Session Continuation
 *
 * Tests the scheduler's ability to reuse sessions across executions.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/scheduler-continuation.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('Scheduler Session Continuation');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('scheduleCreate exists', async () => {
      const exists = await runner.checkApiMethod('scheduleCreate');
      assert.truthy(exists, 'scheduleCreate method should exist');
      return 'Method is available';
    });

    await runner.test('scheduleUpdate exists', async () => {
      const exists = await runner.checkApiMethod('scheduleUpdate');
      assert.truthy(exists, 'scheduleUpdate method should exist');
      return 'Method is available';
    });

    await runner.test('scheduleDelete exists', async () => {
      const exists = await runner.checkApiMethod('scheduleDelete');
      assert.truthy(exists, 'scheduleDelete method should exist');
      return 'Method is available';
    });

    await runner.test('scheduleList exists', async () => {
      const exists = await runner.checkApiMethod('scheduleList');
      assert.truthy(exists, 'scheduleList method should exist');
      return 'Method is available';
    });

    await runner.test('scheduleGet exists', async () => {
      const exists = await runner.checkApiMethod('scheduleGet');
      assert.truthy(exists, 'scheduleGet method should exist');
      return 'Method is available';
    });
  });

  // Get workspace ID for testing
  let workspaceId = 'test-workspace';
  let hasRealWorkspace = false;
  await runner.group('Setup', async () => {
    await runner.test('Get active workspace', async () => {
      const result = await runner.evaluate(`(async () => {
        const config = await window.electronAPI.getConfig();
        return {
          workspaceId: config?.activeWorkspaceId,
          hasWorkspaces: config?.workspaces?.length > 0,
          workspaces: config?.workspaces || []
        };
      })()`, { awaitPromise: true });

      if (result.workspaceId) {
        workspaceId = result.workspaceId;
        hasRealWorkspace = true;
        return `Using workspace: ${workspaceId.slice(0, 8)}...`;
      } else if (result.workspaces?.length > 0) {
        workspaceId = result.workspaces[0].id;
        hasRealWorkspace = true;
        return `Using first workspace: ${workspaceId.slice(0, 8)}...`;
      } else {
        // Use test workspace ID - tests will exercise IPC layer even if workspace doesn't exist
        return `No workspace found, using test ID`;
      }
    });
  });

  // Test Group: Schedule CRUD Operations
  await runner.group('Schedule CRUD Operations', async () => {
    let testScheduleId = null;
    const testScheduleName = `E2E Test Schedule ${Date.now()}`;

    await runner.test('scheduleList returns array', async () => {
      if (!hasRealWorkspace) {
        return 'skip'; // Skip without real workspace
      }
      const result = await runner.evaluate(`(async () => {
        try {
          const schedules = await window.electronAPI.scheduleList('${workspaceId}');
          return {
            isArray: Array.isArray(schedules),
            count: schedules ? schedules.length : 0
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.isArray, 'scheduleList should return an array');
      return `Found ${result.count} existing schedules`;
    });

    await runner.test('scheduleCreate creates one-time schedule', async () => {
      if (!hasRealWorkspace) {
        return 'skip'; // Skip without real workspace
      }
      // Create a one-time schedule set far in the future
      const futureTime = Math.floor(Date.now() / 1000) + 86400 * 365; // 1 year from now

      const result = await runner.evaluate(`(async () => {
        try {
          const schedule = await window.electronAPI.scheduleCreate('${workspaceId}', {
            name: '${testScheduleName}',
            prompt: 'Test prompt for E2E testing',
            scheduledFor: ${futureTime},
            enabled: false
          });
          return {
            success: !!schedule,
            id: schedule?.id,
            name: schedule?.name,
            prompt: schedule?.prompt,
            enabled: schedule?.enabled,
            lastRunSessionId: schedule?.lastRunSessionId
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.success, 'Should create schedule');
      assert.equal(result.name, testScheduleName, 'Schedule name should match');
      assert.equal(result.enabled, false, 'Schedule should be disabled');

      testScheduleId = result.id;
      return `Created schedule with ID: ${testScheduleId}`;
    });

    await runner.test('scheduleGet returns schedule with session fields', async () => {
      if (!testScheduleId) {
        return 'skip';
      }

      const result = await runner.evaluate(`(async () => {
        try {
          const schedule = await window.electronAPI.scheduleGet('${workspaceId}', '${testScheduleId}');
          return {
            found: !!schedule,
            hasLastRunSessionId: 'lastRunSessionId' in schedule,
            hasLastRunAt: 'lastRunAt' in schedule,
            hasLastRunStatus: 'lastRunStatus' in schedule,
            hasExecutionHistory: 'executionHistory' in schedule
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.found, 'Schedule should be found');
      assert.truthy(result.hasLastRunSessionId, 'Should have lastRunSessionId field');
      assert.truthy(result.hasLastRunAt, 'Should have lastRunAt field');
      assert.truthy(result.hasLastRunStatus, 'Should have lastRunStatus field');
      assert.truthy(result.hasExecutionHistory, 'Should have executionHistory field');
      return 'All session continuation fields present';
    });

    await runner.test('scheduleUpdate updates schedule', async () => {
      if (!testScheduleId) {
        return 'skip';
      }

      const updatedName = `${testScheduleName} Updated`;

      const result = await runner.evaluate(`(async () => {
        try {
          const schedule = await window.electronAPI.scheduleUpdate('${workspaceId}', '${testScheduleId}', {
            name: '${updatedName}'
          });
          return {
            success: !!schedule,
            name: schedule?.name
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.equal(result.name, updatedName, 'Name should be updated');
      return 'Schedule updated successfully';
    });

    await runner.test('scheduleDelete removes schedule', async () => {
      if (!testScheduleId) {
        return 'skip';
      }

      const result = await runner.evaluate(`(async () => {
        try {
          await window.electronAPI.scheduleDelete('${workspaceId}', '${testScheduleId}');
          const schedules = await window.electronAPI.scheduleList('${workspaceId}');
          const found = schedules.find(s => s.id === '${testScheduleId}');
          return { deleted: !found };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.deleted, 'Schedule should be deleted');
      return 'Schedule deleted successfully';
    });
  });

  // Test Group: Schedule Types
  await runner.group('Schedule Types', async () => {
    await runner.test('Create recurring cron schedule', async () => {
      if (!hasRealWorkspace) {
        return 'skip'; // Skip without real workspace
      }
      const result = await runner.evaluate(`(async () => {
        try {
          const schedule = await window.electronAPI.scheduleCreate('${workspaceId}', {
            name: 'E2E Cron Test ${Date.now()}',
            prompt: 'Test cron prompt',
            cron: '0 9 * * 1-5',
            timezone: 'America/Los_Angeles',
            enabled: false
          });

          // Cleanup
          if (schedule?.id) {
            await window.electronAPI.scheduleDelete('${workspaceId}', schedule.id);
          }

          return {
            success: !!schedule,
            hasCron: !!schedule?.cron,
            hasTimezone: !!schedule?.timezone
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.success, 'Should create cron schedule');
      assert.truthy(result.hasCron, 'Should have cron expression');
      assert.truthy(result.hasTimezone, 'Should have timezone');
      return 'Cron schedule created and cleaned up';
    });
  });

  // Test Group: Execution History
  await runner.group('Execution History Structure', async () => {
    await runner.test('executionHistory is array with correct structure', async () => {
      if (!hasRealWorkspace) {
        return 'skip'; // Skip without real workspace
      }
      const result = await runner.evaluate(`(async () => {
        try {
          // Create a schedule to inspect its structure
          const schedule = await window.electronAPI.scheduleCreate('${workspaceId}', {
            name: 'E2E History Test ${Date.now()}',
            prompt: 'Test history',
            scheduledFor: ${Math.floor(Date.now() / 1000) + 86400 * 365},
            enabled: false
          });

          const fullSchedule = await window.electronAPI.scheduleGet('${workspaceId}', schedule.id);

          // Cleanup
          await window.electronAPI.scheduleDelete('${workspaceId}', schedule.id);

          return {
            hasHistory: 'executionHistory' in fullSchedule,
            historyIsArray: Array.isArray(fullSchedule.executionHistory),
            historyLength: fullSchedule.executionHistory?.length || 0
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      if (result.error) {
        throw new Error(result.error);
      }

      assert.truthy(result.hasHistory, 'Should have executionHistory');
      assert.truthy(result.historyIsArray, 'executionHistory should be array');
      return `History array with ${result.historyLength} entries`;
    });
  });

  // Test Group: UI Components
  await runner.group('UI Components', async () => {
    await runner.test('Navigate to scheduler settings', async () => {
      await runner.navigateTo('#/settings/scheduler');
      await runner.wait(1000);

      const hasSchedulerContent = await runner.evaluate(`(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('schedule') || text.includes('scheduled');
      })()`);

      return hasSchedulerContent ? 'Scheduler section found' : 'Scheduler section not visible';
    });

    await runner.test('Take screenshot', async () => {
      const path = await runner.screenshot('scheduler-continuation.png');
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
