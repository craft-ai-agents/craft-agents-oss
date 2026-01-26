# Electron E2E Tests

End-to-end tests for Vesper's Electron UI using Chrome DevTools Protocol (CDP).

## Prerequisites

1. **Start Electron with Remote Debugging:**
   ```bash
   bun run electron:dev
   ```
   This starts Electron with `--remote-debugging-port=9222`

2. **Verify CDP is Available:**
   ```bash
   curl -s http://localhost:9222/json
   ```
   You should see a JSON response with available targets.

## Running Tests

### Run All E2E Tests
```bash
bun test apps/electron/src/__tests__/e2e/
```

### Run Specific Test File
```bash
bun test apps/electron/src/__tests__/e2e/telegram-settings.e2e.test.ts
```

## Test Files

### `telegram-settings.e2e.test.ts`
Tests for Telegram integration settings UI:
- Bot token connection flow
- Access control UI (DM/group policies)
- Allowlist management (add/remove users/chats)
- Mention requirement toggle
- Disconnect flow
- Error handling
- Visual verification with screenshots
- electronAPI integration

**Test Coverage:**
- 10 test suites
- 30+ test cases
- Full UI interaction testing
- Screenshot capture for visual verification

## How CDP Testing Works

1. **Connection:** Tests connect to Electron's renderer process via WebSocket
2. **Interaction:** Uses CDP's `Runtime.evaluate` to execute JavaScript in the renderer
3. **Verification:** Checks DOM state, UI elements, and electronAPI availability
4. **Screenshots:** Captures screenshots for visual regression testing

## Test Structure

```typescript
describe('Feature', () => {
  let cdp: CDPClient

  beforeAll(async () => {
    cdp = new CDPClient()
    await cdp.connect()
  })

  afterAll(async () => {
    await cdp.close()
  })

  it('should test something', async () => {
    await cdp.navigateToSettings()
    await cdp.clickByText('Button Text')
    const result = await cdp.getText('.result')
    expect(result).toBe('Expected')
  })
})
```

## CDPClient API

### Navigation
- `navigateToSettings()` - Navigate to settings page
- `waitForSelector(selector, timeout?)` - Wait for element

### Interaction
- `click(selector)` - Click element by CSS selector
- `clickByText(text, selector?)` - Click element by text content
- `fill(selector, value)` - Fill input field

### Verification
- `getText(selector)` - Get text content
- `evaluate(expression)` - Execute arbitrary JavaScript
- `screenshot()` - Capture PNG screenshot (base64)

## Troubleshooting

### "CDP not available at http://localhost:9222"
- Start Electron with: `bun run electron:dev`
- Check that port 9222 is not in use: `lsof -ti:9222`

### "Electron main window not found"
- Ensure the Electron app window is open
- Check `curl http://localhost:9222/json` shows a page target

### "Cannot start http server for devtools"
- Port 9222 is already in use
- Kill existing processes: `lsof -ti:9222 | xargs kill -9`

### Tests Skip in CI/CD
- Frontend E2E tests require a display (X11/Wayland on Linux)
- Use `xvfb-run` for headless testing in CI
- Or skip frontend E2E tests and rely on unit/integration tests

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run E2E Tests
  run: |
    # Start Electron with virtual display
    xvfb-run --auto-servernum bun run electron:dev &
    sleep 5  # Wait for app to start

    # Run E2E tests
    bun test apps/electron/src/__tests__/e2e/

    # Cleanup
    pkill -f electron
```

## Best Practices

1. **Always wait for elements:** Use `waitForSelector()` before interacting
2. **Clean state:** Each test should be independent
3. **Error handling:** Tests should fail gracefully if app isn't running
4. **Screenshots:** Capture on failures for debugging
5. **Timeouts:** Allow sufficient time for async operations (IPC calls)

## Related Documentation

- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
- [Electron Remote Debugging](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- [Bun Test Runner](https://bun.sh/docs/cli/test)
