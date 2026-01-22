/**
 * Real User Test for Ralph Loop
 *
 * Tests the Ralph Loop by starting a loop with a real PRD and monitoring progress.
 */

const WebSocket = require('ws');
const fs = require('fs');

function log(msg) {
  const time = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${time}] ${msg}`);
}

async function getTarget() {
  const response = await fetch('http://localhost:9222/json');
  const targets = await response.json();
  const mainPage = targets.find(t => t.type === 'page' && t.title.includes('Craft'));
  if (!mainPage) {
    throw new Error('Craft Agents window not found');
  }
  return mainPage;
}

async function runRealTest() {
  log('='.repeat(60));
  log('RALPH LOOP REAL USER TEST');
  log('='.repeat(60));
  log('');

  // Read the PRD content
  const prdPath = '/tmp/test-ralph-loop.prd.md';
  const prdContent = fs.readFileSync(prdPath, 'utf-8');
  log(`Loaded PRD from: ${prdPath}`);
  log(`PRD has ${prdContent.split('### [').length - 1} stories`);
  log('');

  // Get CDP target
  const target = await getTarget();
  log(`Connected to: ${target.title}`);

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
        setTimeout(() => {
          if (pendingCallbacks.has(id)) {
            pendingCallbacks.delete(id);
            reject(new Error('Timeout'));
          }
        }, 30000);
      });
    }

    ws.on('message', (data) => {
      const msg = JSON.parse(data);

      // Handle console messages (for loop progress)
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = msg.params.args || [];
        const text = args.map(a => a.value || a.description || '').join(' ');
        if (text.includes('loop') || text.includes('Loop') || text.includes('story') || text.includes('Story')) {
          log(`[CONSOLE] ${text}`);
        }
      }

      // Handle pending callbacks
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
        // Enable Runtime and Console
        await sendCommand('Runtime.enable');
        await sendCommand('Console.enable');

        // Get sessions
        log('');
        log('Getting available sessions...');
        const sessionsResult = await sendCommand('Runtime.evaluate', {
          expression: `(async () => {
            const sessions = await window.electronAPI.getSessions();
            return JSON.stringify(sessions.map(s => ({ id: s.id, name: s.name })));
          })()`,
          awaitPromise: true,
          returnByValue: true
        });

        const sessions = JSON.parse(sessionsResult.result.value);
        log(`Found ${sessions.length} session(s)`);

        if (sessions.length === 0) {
          log('No sessions available. Please create a chat session first.');
          ws.close();
          resolve();
          return;
        }

        const sessionId = sessions[0].id;
        log(`Using session: ${sessionId} (${sessions[0].name || 'unnamed'})`);

        // Check current loop state
        log('');
        log('Checking current loop state...');
        const stateResult = await sendCommand('Runtime.evaluate', {
          expression: `(async () => {
            const state = await window.electronAPI.loopGetState("${sessionId}");
            return JSON.stringify(state);
          })()`,
          awaitPromise: true,
          returnByValue: true
        });

        const currentState = JSON.parse(stateResult.result.value);
        log(`Current loop state: ${currentState ? JSON.stringify(currentState) : 'null (no active loop)'}`);

        // Initialize the agent by sending a test message first
        log('');
        log('Initializing agent with a test message...');
        const initResult = await sendCommand('Runtime.evaluate', {
          expression: `(async () => {
            try {
              await window.electronAPI.sendMessage("${sessionId}", "Initialize session for Ralph Loop test.", []);
              return JSON.stringify({ success: true });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })()`,
          awaitPromise: true,
          returnByValue: true
        });

        const initResponse = JSON.parse(initResult.result.value);
        if (!initResponse.success) {
          log(`Failed to initialize agent: ${initResponse.error}`);
          ws.close();
          resolve();
          return;
        }
        log('Agent initialization message sent. Waiting for agent to be ready...');

        // Wait for the agent to process the initialization message
        await new Promise(r => setTimeout(r, 5000));
        log('Agent should be initialized now.');

        // Escape the PRD content for JavaScript
        const escapedPrd = prdContent
          .replace(/\\/g, '\\\\')
          .replace(/`/g, '\\`')
          .replace(/\$/g, '\\$');

        // Start the loop
        log('');
        log('='.repeat(40));
        log('STARTING RALPH LOOP');
        log('='.repeat(40));
        log('');

        const startResult = await sendCommand('Runtime.evaluate', {
          expression: `(async () => {
            try {
              const prdContent = \`${escapedPrd}\`;
              const result = await window.electronAPI.loopStart("${sessionId}", prdContent, {
                maxIterationsPerStory: 3,
                timeoutPerStoryMs: 120000,
                autoCommit: false
              });
              return JSON.stringify({ success: true, result });
            } catch (error) {
              return JSON.stringify({ success: false, error: error.message });
            }
          })()`,
          awaitPromise: true,
          returnByValue: true
        });

        const startResponse = JSON.parse(startResult.result.value);

        // Check if there's an error in the result
        if (startResponse.result?.error) {
          log(`Loop start error: ${startResponse.result.error}`);
          log('');
          log('NOTE: The Ralph Loop requires an active session with an initialized agent.');
          log('You need to send at least one message in the chat session before starting a loop.');
          log('');
          log('To test manually:');
          log('1. Open the Craft Agents app');
          log('2. Open a chat session and send a simple message like "Hello"');
          log('3. Run this test again');
          ws.close();
          resolve();
          return;
        }

        if (startResponse.success && startResponse.result?.loopId) {
          log(`Loop started! ID: ${startResponse.result.loopId}`);
          log('');
          log('Monitoring loop progress (press Ctrl+C to exit)...');
          log('');

          // Poll for state updates
          let pollCount = 0;
          const maxPolls = 60; // 60 polls * 2 seconds = 2 minutes max

          const pollInterval = setInterval(async () => {
            pollCount++;

            try {
              const pollResult = await sendCommand('Runtime.evaluate', {
                expression: `(async () => {
                  const state = await window.electronAPI.loopGetState("${sessionId}");
                  return JSON.stringify(state);
                })()`,
                awaitPromise: true,
                returnByValue: true
              });

              const state = JSON.parse(pollResult.result.value);

              if (state) {
                const status = state.status || 'unknown';
                const story = state.currentStory ? `${state.currentStory.id}: ${state.currentStory.title}` : 'none';
                const progress = state.progress ? `${state.progress.currentStoryIndex + 1}/${state.progress.totalStories}` : '?/?';
                const iter = state.progress ? `iter ${state.progress.currentIteration}/${state.progress.maxIterations}` : '';

                log(`[Poll ${pollCount}] Status: ${status} | Story: ${progress} ${story} | ${iter}`);

                if (status === 'completed' || status === 'cancelled' || status === 'error') {
                  log('');
                  log('='.repeat(40));
                  log(`LOOP ${status.toUpperCase()}`);
                  log('='.repeat(40));

                  if (state.summary) {
                    log(`Completed: ${state.summary.completedStories}/${state.summary.totalStories}`);
                    log(`Failed: ${state.summary.failedStories}`);
                    log(`Time: ${Math.round(state.summary.totalTimeMs / 1000)}s`);
                  }

                  clearInterval(pollInterval);
                  ws.close();
                  resolve();
                }
              } else {
                log(`[Poll ${pollCount}] No active loop (state is null)`);

                if (pollCount > 5) {
                  log('Loop appears to have ended or never started properly.');
                  clearInterval(pollInterval);
                  ws.close();
                  resolve();
                }
              }

              if (pollCount >= maxPolls) {
                log('Max poll count reached, stopping...');
                clearInterval(pollInterval);
                ws.close();
                resolve();
              }
            } catch (error) {
              log(`[Poll ${pollCount}] Error: ${error.message}`);
            }
          }, 2000);

        } else {
          log(`Failed to start loop: ${startResponse.error || 'Unknown error'}`);
          ws.close();
          resolve();
        }

      } catch (error) {
        log(`Error: ${error.message}`);
        ws.close();
        resolve();
      }
    });

    ws.on('error', (error) => {
      log(`WebSocket error: ${error.message}`);
      resolve();
    });
  });
}

// Run the test
runRealTest()
  .then(() => {
    log('');
    log('Test completed.');
    process.exit(0);
  })
  .catch(error => {
    log(`Fatal error: ${error.message}`);
    process.exit(1);
  });
