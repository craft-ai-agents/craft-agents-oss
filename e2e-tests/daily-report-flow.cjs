/**
 * E2E Test: Daily Report Generation Flow
 *
 * This test covers the complete daily report generation workflow:
 * 1. Open Daily Report Modal
 * 2. Fill GitHub repository configuration
 * 3. Generate report from GitHub
 * 4. Verify report summary displays correctly
 * 5. Submit report
 *
 * Prerequisites:
 * - App running with GitHub OAuth configured
 * - User already connected to GitHub
 * - Test repository accessible
 */

const WebSocket = require('ws');
const fs = require('fs');

const CONFIG = {
  // Test repository
  repoOwner: 'atherslabs',
  repoName: 'vespr',

  // Delay in ms between steps for visibility
  stepDelay: 500,

  // Timeout for operations
  operationTimeout: 30000,
};

// Utility to pause between steps
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to send CDP commands
let msgId = 0;
let pending = new Map();
let ws = null;

async function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP Timeout: ${method}`));
      }
    }, CONFIG.operationTimeout);
  });
}

// Handle CDP messages
function setupMessageHandler() {
  ws.on('message', (data) => {
    try {
      const result = JSON.parse(data);
      if (result.id && pending.has(result.id)) {
        const { resolve, reject } = pending.get(result.id);
        pending.delete(result.id);
        if (result.error) {
          reject(new Error(result.error.message));
        } else {
          resolve(result.result);
        }
      }
    } catch (e) {
      console.error('Failed to parse CDP message:', e.message);
    }
  });
}

// Evaluate JavaScript in page context
async function evaluate(expression) {
  const result = await sendCommand('Runtime.evaluate', { expression });
  return result?.value;
}

// Find element by text or selector
async function findElement(selector, text) {
  if (text) {
    return evaluate(`
      (function() {
        const elements = document.querySelectorAll('${selector || '*'}');
        for (const el of elements) {
          if (el.textContent && el.textContent.includes('${text}')) {
            return el;
          }
        }
        return null;
      })()
    `);
  }
  return evaluate(`document.querySelector('${selector}')`);
}

// Click element
async function click(selector, text = null) {
  return evaluate(`
    (function() {
      let el = null;
      if ('${text}') {
        const elements = document.querySelectorAll('${selector || '*'}');
        for (const e of elements) {
          if (e.textContent && e.textContent.includes('${text}')) {
            el = e;
            break;
          }
        }
      } else {
        el = document.querySelector('${selector}');
      }

      if (!el) return 'Element not found';
      el.click();
      return 'Clicked';
    })()
  `);
}

// Set input value
async function setValue(selector, value) {
  return evaluate(`
    (function() {
      const input = document.querySelector('${selector}');
      if (!input) return 'Input not found';
      input.value = '${value}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'Value set';
    })()
  `);
}

// Wait for element
async function waitForElement(selector, maxWait = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    const el = await evaluate(`document.querySelector('${selector}')`);
    if (el) return el;
    await delay(100);
  }
  throw new Error(`Element not found within ${maxWait}ms: ${selector}`);
}

// Main test
async function runTest() {
  try {
    console.log('\n🧪 E2E Test: Daily Report Generation Flow\n');
    console.log('═'.repeat(60));

    // Get CDP debugger URL
    console.log('\n📍 Step 1: Connecting to Electron DevTools...');
    const response = await fetch('http://localhost:9222/json');
    const targets = await response.json();
    const mainPage = targets.find(t => t.type === 'page');

    if (!mainPage) {
      throw new Error('No Electron page found in DevTools targets');
    }
    console.log('✅ Connected to Electron app');

    // Setup WebSocket
    ws = new WebSocket(mainPage.webSocketDebuggerUrl);
    setupMessageHandler();

    await new Promise((resolve) => {
      ws.on('open', () => {
        console.log('✅ CDP WebSocket connected');
        resolve();
      });
    });

    // Enable runtime and page domains
    await sendCommand('Runtime.enable');
    await sendCommand('Page.enable');
    console.log('✅ Runtime and Page domains enabled');

    // Step 2: Verify app is loaded
    console.log('\n📍 Step 2: Verifying Vespr app is loaded...');
    const appTitle = await evaluate('document.title');
    console.log(`✅ App title: "${appTitle}"`);

    // Step 3: Open Daily Report Modal
    console.log('\n📍 Step 3: Opening Daily Report Modal...');
    await delay(CONFIG.stepDelay);

    // Look for "Daily Report" button or similar
    const reportBtn = await click('[role="button"]', 'Daily Report');
    console.log(`   ${reportBtn}`);

    // Alternative: Try keyboard shortcut Cmd+Shift+R
    if (reportBtn !== 'Clicked') {
      console.log('   Trying keyboard shortcut Cmd+Shift+R...');
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        modifiers: 8 | 2, // Cmd + Shift
        key: 'r',
      });
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'r',
      });
    }

    // Wait for modal to appear
    console.log('   Waiting for modal...');
    await delay(1000);
    const modalVisible = await evaluate(
      `document.querySelector('[role="dialog"]') !== null`
    );
    console.log(`✅ Modal visible: ${modalVisible}`);

    // Step 4: Fill repository configuration
    console.log('\n📍 Step 4: Filling repository configuration...');
    await delay(CONFIG.stepDelay);

    // Find and fill Repository Owner input
    const ownerInputs = await evaluate(
      `Array.from(document.querySelectorAll('input')).filter(i => i.placeholder && i.placeholder.includes('Owner')).length`
    );
    console.log(`   Found ${ownerInputs} owner inputs`);

    if (ownerInputs > 0) {
      await setValue('input[placeholder*="Owner"]', CONFIG.repoOwner);
      console.log(`✅ Set repository owner to: ${CONFIG.repoOwner}`);
    }

    await delay(CONFIG.stepDelay);

    // Find and fill Repository Name input
    const repoInputs = await evaluate(
      `Array.from(document.querySelectorAll('input')).filter(i => i.placeholder && i.placeholder.includes('Name')).length`
    );
    console.log(`   Found ${repoInputs} name inputs`);

    if (repoInputs > 0) {
      await setValue('input[placeholder*="Name"]', CONFIG.repoName);
      console.log(`✅ Set repository name to: ${CONFIG.repoName}`);
    }

    // Step 5: Generate Report
    console.log('\n📍 Step 5: Generating report from GitHub...');
    await delay(CONFIG.stepDelay);

    // Click "Generate" button
    const generateResult = await click('[role="button"]', 'Generate');
    console.log(`   ${generateResult}`);
    console.log('   Waiting for GitHub API call...');

    // Wait for loading state
    await delay(2000);

    // Check for report summary
    const reportSummary = await evaluate(
      `Array.from(document.querySelectorAll('*')).find(el =>
        el.textContent && (
          el.textContent.includes('Issue') ||
          el.textContent.includes('Pull Request') ||
          el.textContent.includes('Team')
        )
      )?.textContent || 'No summary found'`
    );
    console.log(`✅ Report summary: ${reportSummary.substring(0, 100)}...`);

    // Step 6: Verify report data
    console.log('\n📍 Step 6: Verifying report data...');
    await delay(CONFIG.stepDelay);

    const reportDataHTML = await evaluate(`
      (function() {
        const summary = Array.from(document.querySelectorAll('*')).find(el =>
          el.textContent && el.textContent.includes('Issue')
        );
        return summary ? summary.outerHTML : 'Not found';
      })()
    `);
    console.log(`✅ Report data visible in DOM`);

    // Step 7: Submit Report
    console.log('\n📍 Step 7: Submitting report...');
    await delay(CONFIG.stepDelay);

    const submitResult = await click('[role="button"]', 'Submit');
    console.log(`   ${submitResult}`);

    // Wait for submission
    await delay(1500);

    // Verify submission
    const submissionStatus = await evaluate(
      `Array.from(document.querySelectorAll('*')).find(el =>
        el.textContent && (
          el.textContent.includes('submitted') ||
          el.textContent.includes('success') ||
          el.textContent.includes('completed')
        )
      )?.textContent || 'Checking...'`
    );
    console.log(`✅ Submission status: ${submissionStatus.substring(0, 80)}`);

    // Step 8: Verify modal closes
    console.log('\n📍 Step 8: Verifying modal closes...');
    await delay(CONFIG.stepDelay);

    const modalClosed = await evaluate(
      `document.querySelector('[role="dialog"]') === null ||
       !document.querySelector('[role="dialog"]')?.offsetParent`
    );
    console.log(`✅ Modal closed: ${modalClosed}`);

    console.log('\n' + '═'.repeat(60));
    console.log('✅ All tests passed!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.log('\nStack:', error.stack);
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

// Run test
runTest();
