# E2E Tests for Vesper

End-to-end tests for recent Vesper features using Chrome DevTools Protocol (CDP).

## Prerequisites

1. Node.js installed (for running test scripts)
2. Electron app built and running with remote debugging enabled

## Running Tests

### Step 1: Start Electron with CDP

Start the Electron app with remote debugging enabled:

```bash
# Development mode with hot reload
VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron

# Or with full dev server
bun run electron:dev
# Then in another terminal, restart electron with debugging:
# Kill the auto-started electron and run:
VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron
```

### Step 2: Run Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run specific test suite
bun run test:e2e:skills      # Skills Marketplace
bun run test:e2e:terminal    # Terminal Resume Button
bun run test:e2e:labels      # Session Labels
bun run test:e2e:scheduler   # Scheduler Continuation
bun run test:e2e:viewer      # Viewer Backend
bun run test:e2e:whatsapp    # WhatsApp Integration

# Or run directly with options
node scripts/e2e/run-all.cjs --test=skills-marketplace
node scripts/e2e/run-all.cjs --parallel  # Run all in parallel
```

## Test Suites

| Suite | File | Feature |
|-------|------|---------|
| skills-marketplace | `skills-marketplace.e2e.cjs` | Skills.sh marketplace integration |
| terminal-resume | `terminal-resume.e2e.cjs` | Terminal resume button for SDK sessions |
| session-labels | `session-labels.e2e.cjs` | Session label CRUD operations |
| scheduler-continuation | `scheduler-continuation.e2e.cjs` | Scheduler session reuse |
| viewer-backend | `viewer-backend.e2e.cjs` | Viewer service abstraction |
| whatsapp-integration | `whatsapp-integration.e2e.cjs` | WhatsApp connection and messaging |

## Test Utilities

The `cdp-utils.cjs` module provides:

- `E2ETestRunner` - Test runner with CDP connection management
- `CDPConnection` - WebSocket connection to Chrome DevTools
- `TestResults` - Pass/fail/skip tracking and reporting
- `assert` - Assertion helpers

### Example Test

```javascript
const { E2ETestRunner, assert } = require('./cdp-utils.cjs');

async function runTests() {
  const runner = new E2ETestRunner('My Feature');

  const connected = await runner.setup();
  if (!connected) return runner.teardown();

  await runner.group('API Methods', async () => {
    await runner.test('myMethod exists', async () => {
      const exists = await runner.checkApiMethod('myMethod');
      assert.truthy(exists, 'myMethod should exist');
      return 'Method is available';
    });

    await runner.test('myMethod returns data', async () => {
      const result = await runner.evaluate(`(async () => {
        return await window.electronAPI.myMethod();
      })()`, { awaitPromise: true });

      assert.isObject(result, 'Should return object');
      return 'Data returned successfully';
    });
  });

  return runner.teardown();
}

runTests()
  .then(exitCode => process.exit(exitCode))
  .catch(error => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
```

## Screenshots

Tests automatically capture screenshots to `/tmp/vesper-e2e/`. Each test suite captures at least one screenshot of the relevant UI state.

## CI Integration

For CI/CD pipelines, use Xvfb for headless testing on Linux:

```yaml
- name: Run E2E Tests
  run: |
    Xvfb :99 -screen 0 1920x1080x24 &
    export DISPLAY=:99
    VITE_DEV_SERVER_URL=http://localhost:5173 electron --remote-debugging-port=9222 apps/electron &
    sleep 5
    bun run test:e2e
```

## Debugging

- Check CDP connection: `curl http://localhost:9222/json`
- View screenshots: `open /tmp/vesper-e2e/`
- Enable verbose logging: Modify test file to add `console.log` statements

## Adding New Tests

1. Create `my-feature.e2e.cjs` in `scripts/e2e/`
2. Use `E2ETestRunner` from `cdp-utils.cjs`
3. Add to `TEST_SUITES` in `run-all.cjs`
4. Add npm script to `package.json`
