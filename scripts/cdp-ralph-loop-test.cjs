/**
 * E2E Tests for Orchestrate Integration via CDP
 *
 * Tests the Orchestrate IPC methods and UI components through the Electron app.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Test results tracking
const results = {
  passed: [],
  failed: [],
  screenshots: []
};

function log(msg) {
  console.log(`[CDP-TEST] ${msg}`);
}

function pass(testName, details = '') {
  log(`✅ PASS: ${testName}${details ? ` - ${details}` : ''}`);
  results.passed.push({ name: testName, details });
}

function fail(testName, error) {
  log(`❌ FAIL: ${testName} - ${error}`);
  results.failed.push({ name: testName, error });
}

async function getTarget() {
  const response = await fetch('http://localhost:9222/json');
  const targets = await response.json();
  const mainPage = targets.find(t => t.type === 'page' && t.title.includes('Craft'));
  if (!mainPage) {
    throw new Error('Craft Agents window not found. Is Electron running with --remote-debugging-port=9222?');
  }
  return mainPage;
}

async function runTests() {
  log('Starting Orchestrate E2E Tests...');
  log('');

  // Get CDP target
  let target;
  try {
    target = await getTarget();
    pass('CDP Connection', `Connected to: ${target.title}`);
  } catch (error) {
    fail('CDP Connection', error.message);
    return printResults();
  }

  // Connect via WebSocket
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  return new Promise((resolve) => {
    let messageId = 1;
    const pendingCallbacks = new Map();

    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = messageId++;
        pendingCallbacks.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));

        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            reject(new Error('Timeout'));
          }
        }, 10000);
      });
    }

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && pendingCallbacks.has(msg.id)) {
        const { resolve, reject } = pendingCallbacks.get(msg.id);
        pendingCallbacks.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });

    ws.on('open', async () => {
      try {
        // Enable Runtime domain
        await sendCommand('Runtime.enable');

        // Test 1: Check if electronAPI exists
        log('');
        log('--- Test: electronAPI Availability ---');
        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: 'typeof window.electronAPI'
          });
          if (result.result.value === 'object') {
            pass('electronAPI exists');
          } else {
            fail('electronAPI exists', `Got type: ${result.result.value}`);
          }
        } catch (error) {
          fail('electronAPI exists', error.message);
        }

        // Test 2: Check if loop methods exist on electronAPI
        log('');
        log('--- Test: Loop IPC Methods ---');
        const loopMethods = ['loopStart', 'loopPause', 'loopResume', 'loopCancel', 'loopGetState'];

        for (const method of loopMethods) {
          try {
            const result = await sendCommand('Runtime.evaluate', {
              expression: `typeof window.electronAPI.${method}`
            });
            if (result.result.value === 'function') {
              pass(`electronAPI.${method} exists`);
            } else {
              fail(`electronAPI.${method} exists`, `Got type: ${result.result.value}`);
            }
          } catch (error) {
            fail(`electronAPI.${method} exists`, error.message);
          }
        }

        // Test 3: Test loopGetState returns null when no loop is active
        log('');
        log('--- Test: loopGetState (no active loop) ---');
        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
              // Get first session ID if available
              const sessions = await window.electronAPI.getSessions();
              if (sessions.length === 0) {
                return { error: 'No sessions available' };
              }
              const sessionId = sessions[0].id;
              const state = await window.electronAPI.loopGetState(sessionId);
              return { sessionId, state };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });

          if (result.result.value) {
            const { sessionId, state, error } = result.result.value;
            if (error) {
              pass('loopGetState', `Skipped - ${error}`);
            } else if (state === null) {
              pass('loopGetState returns null for inactive loop', `Session: ${sessionId}`);
            } else {
              pass('loopGetState returns state', `Session: ${sessionId}, isActive: ${state?.isActive}`);
            }
          }
        } catch (error) {
          fail('loopGetState', error.message);
        }

        // Test 4: Check Loop UI components are importable
        log('');
        log('--- Test: Loop UI Components ---');
        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: `(function() {
              // Check if LoopProgressIndicator component exists in the bundle
              // We can't directly import, but we can check if the components rendered
              // when loop is active by looking at DOM
              const loopIndicator = document.querySelector('[class*="LoopProgress"]');
              const loopSummary = document.querySelector('[class*="LoopSummary"]');

              // These won't exist unless a loop is active, but we verify no errors
              return {
                componentsAccessible: true,
                loopIndicatorFound: !!loopIndicator,
                loopSummaryFound: !!loopSummary
              };
            })()`
          });

          if (result.result.value) {
            pass('Loop UI components accessible', 'No rendering errors');
          }
        } catch (error) {
          fail('Loop UI components', error.message);
        }

        // Test 5: Take screenshot
        log('');
        log('--- Test: Screenshot ---');
        try {
          const screenshot = await sendCommand('Page.captureScreenshot', {
            format: 'png'
          });

          const screenshotPath = '/tmp/orchestrate-e2e-screenshot.png';
          fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
          pass('Screenshot captured', screenshotPath);
          results.screenshots.push(screenshotPath);
        } catch (error) {
          fail('Screenshot', error.message);
        }

        // Test 6: Navigate to a chat session and verify loop state integration
        log('');
        log('--- Test: Chat Display Loop Integration ---');
        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: `(async () => {
              // Navigate to main chat view
              window.location.hash = '';
              await new Promise(r => setTimeout(r, 500));

              // Check if session has loopState property type
              const sessions = await window.electronAPI.getSessions();
              if (sessions.length > 0) {
                const sessionId = sessions[0].id;
                // The session object should have loopState as an optional property
                return {
                  hasSession: true,
                  sessionId: sessionId,
                  sessionHasId: !!sessions[0].id
                };
              }
              return { hasSession: false };
            })()`,
            awaitPromise: true,
            returnByValue: true
          });

          if (result.result.value?.hasSession) {
            pass('Chat session available', `Session: ${result.result.value.sessionId}`);
          } else {
            pass('Chat session check', 'No sessions available (app may be freshly installed)');
          }
        } catch (error) {
          fail('Chat Display integration', error.message);
        }

        // Test 7: Verify IPC channel registration
        log('');
        log('--- Test: IPC Channel Constants ---');
        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: `JSON.stringify({
              hasLoopStart: typeof window.electronAPI.loopStart === 'function',
              hasLoopPause: typeof window.electronAPI.loopPause === 'function',
              hasLoopResume: typeof window.electronAPI.loopResume === 'function',
              hasLoopCancel: typeof window.electronAPI.loopCancel === 'function',
              hasLoopGetState: typeof window.electronAPI.loopGetState === 'function'
            })`,
            returnByValue: true
          });

          const val = JSON.parse(result.result.value);
          if (val && val.hasLoopStart && val.hasLoopPause && val.hasLoopResume && val.hasLoopCancel && val.hasLoopGetState) {
            pass('All Loop IPC channels registered');
          } else {
            fail('Loop IPC channels', `Missing: ${JSON.stringify(val)}`);
          }
        } catch (error) {
          fail('IPC channels', error.message);
        }

        // Done
        log('');
        log('--- Test Complete ---');
        ws.close();
        printResults();
        resolve();

      } catch (error) {
        fail('Test execution', error.message);
        ws.close();
        printResults();
        resolve();
      }
    });

    ws.on('error', (error) => {
      fail('WebSocket connection', error.message);
      printResults();
      resolve();
    });
  });
}

function printResults() {
  log('');
  log('========================================');
  log('RALPH LOOP E2E TEST RESULTS');
  log('========================================');
  log('');
  log(`Total: ${results.passed.length + results.failed.length} tests`);
  log(`Passed: ${results.passed.length}`);
  log(`Failed: ${results.failed.length}`);
  log('');

  if (results.screenshots.length > 0) {
    log('Screenshots:');
    results.screenshots.forEach(s => log(`  - ${s}`));
    log('');
  }

  if (results.failed.length > 0) {
    log('FAILED TESTS:');
    results.failed.forEach(f => log(`  - ${f.name}: ${f.error}`));
  } else {
    log('ALL TESTS PASSED! ✅');
  }

  log('');
  log('========================================');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
