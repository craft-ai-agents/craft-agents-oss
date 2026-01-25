/**
 * CDP E2E Test Utilities
 *
 * Shared utilities for Chrome DevTools Protocol based E2E testing.
 * Provides connection management, test runners, and common assertions.
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

/**
 * Test result tracking
 */
class TestResults {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.passed = [];
    this.failed = [];
    this.skipped = [];
    this.screenshots = [];
    this.startTime = Date.now();
  }

  pass(testName, details = '') {
    console.log(`[E2E] ✅ PASS: ${testName}${details ? ` - ${details}` : ''}`);
    this.passed.push({ name: testName, details });
  }

  fail(testName, error) {
    console.log(`[E2E] ❌ FAIL: ${testName} - ${error}`);
    this.failed.push({ name: testName, error: String(error) });
  }

  skip(testName, reason = '') {
    console.log(`[E2E] ⏭️  SKIP: ${testName}${reason ? ` - ${reason}` : ''}`);
    this.skipped.push({ name: testName, reason });
  }

  addScreenshot(filePath) {
    this.screenshots.push(filePath);
  }

  print() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    console.log('');
    console.log('========================================');
    console.log(`E2E TEST RESULTS: ${this.suiteName}`);
    console.log('========================================');
    console.log('');
    console.log(`Duration: ${duration}s`);
    console.log(`Total: ${this.passed.length + this.failed.length + this.skipped.length} tests`);
    console.log(`Passed: ${this.passed.length}`);
    console.log(`Failed: ${this.failed.length}`);
    console.log(`Skipped: ${this.skipped.length}`);
    console.log('');

    if (this.screenshots.length > 0) {
      console.log('Screenshots:');
      this.screenshots.forEach(s => console.log(`  - ${s}`));
      console.log('');
    }

    if (this.failed.length > 0) {
      console.log('FAILED TESTS:');
      this.failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
    } else if (this.passed.length > 0) {
      console.log('ALL TESTS PASSED! ✅');
    }

    console.log('');
    console.log('========================================');

    return this.failed.length === 0;
  }

  getExitCode() {
    return this.failed.length > 0 ? 1 : 0;
  }
}

/**
 * CDP Connection Manager
 */
class CDPConnection {
  constructor() {
    this.ws = null;
    this.messageId = 1;
    this.pendingCallbacks = new Map();
    this.eventListeners = new Map();
  }

  /**
   * Get CDP target from Electron's debugging endpoint
   */
  async getTarget(titlePattern = 'Vespr') {
    const response = await fetch('http://localhost:9222/json');
    const targets = await response.json();

    // Find the main renderer page
    const mainPage = targets.find(t =>
      t.type === 'page' &&
      (t.title.includes(titlePattern) || t.title.includes('Vesper') || t.title.includes('Craft'))
    );

    if (!mainPage) {
      throw new Error(
        `Vespr window not found. Is Electron running with --remote-debugging-port=9222?\n` +
        `Available targets: ${targets.map(t => `${t.type}: ${t.title}`).join(', ')}`
      );
    }

    return mainPage;
  }

  /**
   * Connect to CDP target via WebSocket
   */
  async connect(target) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(target.webSocketDebuggerUrl);

      this.ws.on('open', () => resolve());
      this.ws.on('error', (error) => reject(error));

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data);

        // Handle response to commands
        if (msg.id && this.pendingCallbacks.has(msg.id)) {
          const { resolve, reject } = this.pendingCallbacks.get(msg.id);
          this.pendingCallbacks.delete(msg.id);

          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }

        // Handle CDP events
        if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          listeners.forEach(listener => listener(msg.params));
        }
      });
    });
  }

  /**
   * Send CDP command
   */
  sendCommand(method, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      this.pendingCallbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));

      setTimeout(() => {
        if (this.pendingCallbacks.has(id)) {
          this.pendingCallbacks.delete(id);
          reject(new Error(`Timeout waiting for ${method}`));
        }
      }, timeout);
    });
  }

  /**
   * Subscribe to CDP events
   */
  on(method, listener) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(listener);
  }

  /**
   * Close connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Test Runner for E2E tests
 */
class E2ETestRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.results = new TestResults(suiteName);
    this.cdp = new CDPConnection();
  }

  /**
   * Initialize CDP connection
   */
  async setup() {
    console.log(`[E2E] Starting ${this.suiteName} tests...`);
    console.log('');

    try {
      const target = await this.cdp.getTarget();
      this.results.pass('CDP Connection', `Connected to: ${target.title}`);

      await this.cdp.connect(target);
      await this.cdp.sendCommand('Runtime.enable');
      await this.cdp.sendCommand('Page.enable');

      return true;
    } catch (error) {
      this.results.fail('CDP Connection', error.message);
      return false;
    }
  }

  /**
   * Evaluate JavaScript in the renderer context
   */
  async evaluate(expression, options = {}) {
    const { awaitPromise = false, returnByValue = true } = options;

    const result = await this.cdp.sendCommand('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue,
    });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation error');
    }

    return result.result.value;
  }

  /**
   * Check if electronAPI method exists and is a function
   */
  async checkApiMethod(methodName) {
    const type = await this.evaluate(`typeof window.electronAPI.${methodName}`);
    return type === 'function';
  }

  /**
   * Call electronAPI method and return result
   */
  async callApi(methodName, ...args) {
    const argsJson = JSON.stringify(args);
    const expression = `(async () => {
      return await window.electronAPI.${methodName}(${argsJson.slice(1, -1)});
    })()`;

    return await this.evaluate(expression, { awaitPromise: true });
  }

  /**
   * Query DOM element
   */
  async querySelector(selector) {
    return await this.evaluate(`!!document.querySelector('${selector}')`);
  }

  /**
   * Query all DOM elements and return count
   */
  async querySelectorAll(selector) {
    return await this.evaluate(`document.querySelectorAll('${selector}').length`);
  }

  /**
   * Take screenshot
   */
  async screenshot(filename) {
    const screenshotDir = '/tmp/vespr-e2e';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const screenshot = await this.cdp.sendCommand('Page.captureScreenshot', {
      format: 'png',
    });

    const filePath = path.join(screenshotDir, filename);
    fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
    this.results.addScreenshot(filePath);

    return filePath;
  }

  /**
   * Navigate to hash route
   */
  async navigateTo(hash) {
    await this.evaluate(`window.location.hash = '${hash}'`);
    await this.wait(500); // Wait for navigation
  }

  /**
   * Wait for specified milliseconds
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run a test case
   */
  async test(name, fn) {
    console.log('');
    console.log(`--- Test: ${name} ---`);

    try {
      const result = await fn();
      if (result === 'skip') {
        this.results.skip(name);
      } else {
        this.results.pass(name, typeof result === 'string' ? result : '');
      }
    } catch (error) {
      this.results.fail(name, error.message);
    }
  }

  /**
   * Run test group
   */
  async group(name, fn) {
    console.log('');
    console.log(`=== ${name} ===`);
    await fn();
  }

  /**
   * Cleanup and print results
   */
  teardown() {
    this.cdp.close();
    const success = this.results.print();
    return this.results.getExitCode();
  }
}

/**
 * Assertion helpers
 */
const assert = {
  equal(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  truthy(value, message = '') {
    if (!value) {
      throw new Error(message || `Expected truthy value, got ${value}`);
    }
  },

  falsy(value, message = '') {
    if (value) {
      throw new Error(message || `Expected falsy value, got ${value}`);
    }
  },

  includes(array, item, message = '') {
    if (!array.includes(item)) {
      throw new Error(message || `Expected array to include ${item}`);
    }
  },

  isArray(value, message = '') {
    if (!Array.isArray(value)) {
      throw new Error(message || `Expected array, got ${typeof value}`);
    }
  },

  isObject(value, message = '') {
    if (typeof value !== 'object' || value === null) {
      throw new Error(message || `Expected object, got ${typeof value}`);
    }
  },

  hasProperty(obj, prop, message = '') {
    if (!(prop in obj)) {
      throw new Error(message || `Expected object to have property ${prop}`);
    }
  },
};

module.exports = {
  TestResults,
  CDPConnection,
  E2ETestRunner,
  assert,
};
