#!/usr/bin/env node
/**
 * Test script for Orchestrate via CDP
 *
 * Usage: node scripts/test-orchestrate.cjs
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 9222;
const TEST_DIR = '/tmp/ralph-test';
const LOG_FILE = '/tmp/electron-ralph-test.log';

// PRD for testing - simple file creation tasks
const TEST_PRD = `---
title: Orchestrate Integration Test
version: 1.0.0
author: Test Script
---

# Goal
Create simple test files to verify Orchestrate execution.

# User Stories

## TEST-001: Create a greeting file
Create a file at /tmp/ralph-test/hello.txt containing "Hello from Orchestrate!"

## TEST-002: Create a timestamp file
Create a file at /tmp/ralph-test/timestamp.txt with the current date and time.

## TEST-003: List the created files
List the contents of /tmp/ralph-test/ directory and report what files exist.
`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCDPTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${CDP_PORT}/json`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const targets = JSON.parse(data);
          const mainPage = targets.find(t =>
            t.type === 'page' &&
            !t.title.includes('DevTools') &&
            (t.url.includes('localhost:5173') || t.url.includes('renderer/index.html'))
          );
          if (mainPage) {
            resolve(mainPage);
          } else {
            reject(new Error('Main Electron page not found in CDP targets'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => reject(new Error('CDP request timeout')));
  });
}

let msgIdCounter = 1;

async function evalInPage(ws, expression, awaitPromise = true) {
  return new Promise((resolve, reject) => {
    const id = msgIdCounter++;

    const handler = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.removeListener('message', handler);
          clearTimeout(timeoutId);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else if (msg.result?.exceptionDetails) {
            reject(new Error(msg.result.exceptionDetails.text || 'Evaluation error'));
          } else {
            resolve(msg.result?.result?.value);
          }
        }
      } catch (e) {
        // Ignore parse errors from other messages
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: {
        expression,
        awaitPromise,
        returnByValue: true
      }
    }));

    const timeoutId = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`Evaluation timeout for: ${expression.slice(0, 50)}...`));
    }, 30000);
  });
}

async function main() {
  console.log('='.repeat(60));
  console.log('Orchestrate Integration Test');
  console.log('='.repeat(60));

  // Clean up test directory
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  console.log(`\nTest directory created: ${TEST_DIR}`);

  // Get CDP target
  console.log('\n1. Connecting to Electron via CDP...');
  let target;
  try {
    target = await getCDPTarget();
    console.log(`   Connected to: ${target.title}`);
  } catch (e) {
    console.error(`   Failed to connect: ${e.message}`);
    console.error('   Make sure Electron is running with --remote-debugging-port=9222');
    process.exit(1);
  }

  // Connect WebSocket
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('   WebSocket connected');

  // Enable console logging from page
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = msg.params.args.map(a => a.value || a.description).join(' ');
      console.log(`   [CONSOLE] ${args}`);
    }
  });
  await evalInPage(ws, 'true'); // dummy call to enable console
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));

  // Check electronAPI
  console.log('\n2. Checking electronAPI...');
  const hasAPI = await evalInPage(ws, 'typeof window.electronAPI');
  if (hasAPI !== 'object') {
    console.error('   electronAPI not available!');
    ws.close();
    process.exit(1);
  }
  console.log('   electronAPI is available');

  // Get sessions
  console.log('\n3. Getting sessions...');
  const sessionsJson = await evalInPage(ws, `
    window.electronAPI.getSessions().then(s => JSON.stringify(s))
  `);
  const sessions = JSON.parse(sessionsJson);
  console.log(`   Found ${sessions.length} sessions`);

  if (sessions.length === 0) {
    console.log('   Creating new session...');
    await evalInPage(ws, `window.electronAPI.createSession()`);
    await sleep(2000);
    const newSessions = JSON.parse(await evalInPage(ws, `
      window.electronAPI.getSessions().then(s => JSON.stringify(s))
    `));
    sessions.push(...newSessions);
  }

  const session = sessions[0];
  console.log(`   Using session: ${session.id}`);

  // Set permission mode to ralph
  console.log('\n4. Setting permission mode to "ralph"...');
  try {
    const modeResult = await evalInPage(ws, `
      window.electronAPI.sessionCommand('${session.id}', { type: 'setPermissionMode', mode: 'ralph' })
        .then(r => JSON.stringify(r))
    `);
    console.log(`   Result: ${modeResult || 'OK'}`);
  } catch (e) {
    console.log(`   Warning: ${e.message}`);
  }
  console.log('   Permission mode set to ralph');

  // Send an init message first to warm up the session
  console.log('\n5. Initializing session with warm-up message...');
  await evalInPage(ws, `
    window.electronAPI.sendMessage('${session.id}', 'Hello! Please respond briefly.')
  `, false);

  console.log('   Waiting for response...');
  await sleep(20000); // Wait for agent to respond

  // Check recent logs for errors (only last 50 lines)
  const logs = fs.readFileSync(LOG_FILE, 'utf8');
  const recentLines = logs.split('\n').slice(-50).join('\n');
  if (recentLines.includes('OUTER CATCH triggered') || recentLines.includes('Session 260122-dynamic-hawk completed without assistant response')) {
    console.log('\n   WARNING: Recent SDK errors detected in logs');
    console.log('   Recent logs:');
    console.log(recentLines.slice(-1500));
    console.log('\n   Proceeding anyway to test Orchestrate...');
  } else {
    console.log('   Warm-up message successful!');
  }

  // Start Orchestrate
  console.log('\n6. Starting Orchestrate...');
  const startResult = await evalInPage(ws, `
    window.electronAPI.sessionCommand('${session.id}', {
      type: 'startLoop',
      prdContent: ${JSON.stringify(TEST_PRD)},
      config: {
        maxIterationsPerStory: 3,
        timeoutPerStoryMs: 120000,
        autoCommit: false
      }
    }).then(r => JSON.stringify(r))
  `);
  console.log(`   Start response: ${startResult}`);

  const startData = JSON.parse(startResult);
  if (startData.error) {
    console.error(`   Error: ${startData.error}`);
    ws.close();
    process.exit(1);
  }

  console.log(`   Loop started! ID: ${startData.result?.loopId}`);

  // Poll loop state
  console.log('\n7. Monitoring loop progress...');
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes max

  while (attempts < maxAttempts) {
    await sleep(2000);
    attempts++;

    const stateJson = await evalInPage(ws, `
      window.electronAPI.sessionCommand('${session.id}', { type: 'getLoopState' })
        .then(r => JSON.stringify(r))
    `);
    const state = JSON.parse(stateJson);

    if (!state.result || !state.result.isActive) {
      console.log(`   [Poll ${attempts}] Loop completed or no active loop`);
      break;
    }

    const progress = state.result.progress;
    console.log(`   [Poll ${attempts}] Story ${progress?.currentStoryIndex || 0}/${progress?.totalStories || 0} - Status: ${state.result.status}`);
  }

  // Check results
  console.log('\n8. Checking results...');
  const files = fs.existsSync(TEST_DIR) ? fs.readdirSync(TEST_DIR) : [];
  console.log(`   Files in ${TEST_DIR}:`, files);

  if (files.includes('hello.txt')) {
    console.log('   ✓ hello.txt created');
    console.log(`     Content: ${fs.readFileSync(path.join(TEST_DIR, 'hello.txt'), 'utf8').trim()}`);
  } else {
    console.log('   ✗ hello.txt NOT created');
  }

  if (files.includes('timestamp.txt')) {
    console.log('   ✓ timestamp.txt created');
    console.log(`     Content: ${fs.readFileSync(path.join(TEST_DIR, 'timestamp.txt'), 'utf8').trim()}`);
  } else {
    console.log('   ✗ timestamp.txt NOT created');
  }

  ws.close();
  console.log('\n' + '='.repeat(60));
  console.log('Test completed!');
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
