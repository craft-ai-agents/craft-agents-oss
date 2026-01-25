/**
 * E2E Tests for Terminal Resume Button
 *
 * Tests the terminal spawning functionality for resuming Claude Code sessions.
 *
 * Run with Electron debugging enabled:
 *   VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
 *   node scripts/e2e/terminal-resume.e2e.cjs
 */

const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('Terminal Resume Button');

  // Setup CDP connection
  const connected = await runner.setup();
  if (!connected) {
    return runner.teardown();
  }

  // Test Group: electronAPI Availability
  await runner.group('electronAPI Methods', async () => {
    await runner.test('spawnTerminal exists', async () => {
      const exists = await runner.checkApiMethod('spawnTerminal');
      assert.truthy(exists, 'spawnTerminal method should exist');
      return 'Method is available';
    });
  });

  // Test Group: Session ID Validation
  await runner.group('Session ID Validation', async () => {
    await runner.test('spawnTerminal rejects invalid session ID format', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'invalid-session-id',
            workingDirectory: '/tmp'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // Should fail with invalid format error
      if (result.success === false && result.error && result.error.includes('Invalid session ID')) {
        return 'Correctly rejected invalid format';
      }

      // Also acceptable if it throws
      if (result.error) {
        return `Rejected with: ${result.error}`;
      }

      throw new Error('Should reject invalid session ID format');
    });

    await runner.test('spawnTerminal accepts valid UUID session ID format', async () => {
      // Note: This test verifies the format is accepted, not that it actually spawns
      // We use a valid format but don't actually have this session
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'ses-12345678-1234-1234-1234-123456789012',
            workingDirectory: '/tmp'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // Should not fail with format error (may fail for other reasons like terminal not available)
      if (result.error && result.error.includes('Invalid session ID')) {
        throw new Error('Should accept valid UUID format');
      }

      return 'Valid format accepted';
    });

    await runner.test('spawnTerminal accepts short hex session ID format', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'ses-abc123def456',
            workingDirectory: '/tmp'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // Should not fail with format error
      if (result.error && result.error.includes('Invalid session ID')) {
        throw new Error('Should accept short hex format');
      }

      return 'Short format accepted';
    });
  });

  // Test Group: Working Directory Handling
  await runner.group('Working Directory Handling', async () => {
    await runner.test('spawnTerminal handles non-existent directory', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'ses-abc123def456',
            workingDirectory: '/nonexistent/path/that/does/not/exist'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // Should fallback to home directory, not throw
      // The response should be success:true or an error about terminal, not about directory
      if (result.error && result.error.includes('directory')) {
        throw new Error('Should handle non-existent directory gracefully');
      }

      return 'Handled gracefully';
    });

    await runner.test('spawnTerminal accepts valid directory', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'ses-abc123def456',
            workingDirectory: '/tmp'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // /tmp should exist on macOS/Linux
      if (result.error && result.error.includes('directory')) {
        throw new Error('Should accept valid /tmp directory');
      }

      return 'Valid directory accepted';
    });
  });

  // Test Group: Task List ID
  await runner.group('Task List ID Environment Variable', async () => {
    await runner.test('spawnTerminal accepts taskListId parameter', async () => {
      const result = await runner.evaluate(`(async () => {
        try {
          const response = await window.electronAPI.spawnTerminal({
            sdkSessionId: 'ses-abc123def456',
            workingDirectory: '/tmp',
            taskListId: 'task-list-123'
          });
          return response;
        } catch (e) {
          return { error: e.message };
        }
      })()`, { awaitPromise: true });

      // Should not throw for having taskListId parameter
      if (result.error && result.error.includes('taskListId')) {
        throw new Error('Should accept taskListId parameter');
      }

      return 'taskListId parameter accepted';
    });
  });

  // Test Group: TerminalResumeButton UI Component
  await runner.group('UI Component', async () => {
    await runner.test('TerminalResumeButton visibility check', async () => {
      // Navigate to a session if one exists
      const result = await runner.evaluate(`(async () => {
        const sessions = await window.electronAPI.getSessions();
        if (sessions.length === 0) {
          return { noSessions: true };
        }

        // Navigate to first session
        window.location.hash = '';
        await new Promise(r => setTimeout(r, 500));

        // Check for terminal resume button (may be hidden until SDK session exists)
        const button = document.querySelector('[data-testid="terminal-resume-button"], [class*="TerminalResume"]');
        return {
          buttonFound: !!button,
          sessionId: sessions[0].id
        };
      })()`, { awaitPromise: true });

      if (result.noSessions) {
        return 'skip';
      }

      return `Button visibility checked for session ${result.sessionId}`;
    });

    await runner.test('Take screenshot', async () => {
      const path = await runner.screenshot('terminal-resume.png');
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
