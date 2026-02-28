# Browser Tools

Use browser tools to control built-in **browser windows** (Chromium) inside Craft Agents.

> **Quick start:** Run `browser_tool --help` to see all available commands and usage examples. This is the fastest way to discover what's available and how to call it.

## Browser usage paths

1. **Primary (recommended):** `browser_tool` command tool — unified CLI-like interface with strict validation and actionable feedback.
2. **Direct tools:** `browser_*` tools (`browser_open`, `browser_navigate`, ...) when you have exact structured arguments. These are stateful and session-bound.
3. **Secondary helper:** `browser-tool` CLI helper (`bun run browser-tool --help`) for operation discovery and JSON templates.

---

## Core workflow

If you're unsure which window to use, run `browser_tool({ command: "windows" })` first.

When the browser might not be open or focused, **start with `browser_open`**:

1. `browser_open` — ensure browser window exists (opens in background by default)
2. `browser_navigate` — load a URL or search query
3. `browser_snapshot` — inspect accessible elements and get refs (`@e1`, `@e2`, ...)
4. `browser_click` / `browser_fill` / `browser_select` — interact using refs
5. `browser_screenshot` — visual verification when needed

---

## `browser_tool` command wrapper

Use `browser_tool` when you want one command-style entry point:

```text
browser_tool({ command: "--help" })
browser_tool({ command: "open" })
browser_tool({ command: "open --foreground" })
browser_tool({ command: "navigate https://example.com" })
browser_tool({ command: "snapshot" })
browser_tool({ command: "click @e12" })
browser_tool({ command: "fill @e5 user@example.com" })
browser_tool({ command: "scroll down 800" })
browser_tool({ command: "evaluate document.title" })
browser_tool({ command: "console 50 warn" })
browser_tool({ command: "screenshot-region 100 200 640 480" })
browser_tool({ command: "screenshot-region --ref @e12 --padding 8" })
browser_tool({ command: "screenshot-region --selector div[data-testid=\"chart\"]" })
browser_tool({ command: "window-resize 1280 720" })
browser_tool({ command: "network 50 failed" })
browser_tool({ command: "wait network-idle 8000" })
browser_tool({ command: "key Enter" })
browser_tool({ command: "key k meta" })
browser_tool({ command: "downloads wait 15000" })
browser_tool({ command: "windows" })
browser_tool({ command: "release" })
browser_tool({ command: "close" })
browser_tool({ command: "hide" })
```

The wrapper validates commands and returns actionable errors when arguments are missing or invalid.

### `browser_tool windows`
List currently known browser windows and ownership state.

**Use when:**
- deciding whether to reuse an existing window
- checking if a session-bound window already exists
- confirming whether agent control is currently active on any window

**Output fields per window:**
- `id`
- `title`
- `url`
- `visible`
- `ownerType`
- `ownerSessionId`
- `boundSessionId`
- `lockState` (`unlocked` or `locked-session(...)`)
- `availableToSession` (whether current agent session can reuse without rebinding conflicts)
- `agentControlActive`

---

## Tool details

### `browser_open`
Create or reuse the session's browser window instance. Opens in the **background** by default.

**Use when:**
- Starting a browser workflow
- Ensuring a browser instance exists before navigating

**CLI variant:** `browser_tool open [--foreground|-f]`
- Without flag: creates/reuses window in background (default)
- With `--foreground` or `-f`: shows and focuses the window

**Returns:** browser instance ID

---

### `browser_navigate`
Navigate to a URL. If input is not a URL, implementations may treat it as a search query.

**Use when:**
- Loading a new page
- Redirecting to another site/workflow step

**Tip:** call `browser_open` first if visibility/focus is uncertain.

---

### `browser_snapshot`
Returns a structured accessibility tree with element refs and metadata.

**Use when:**
- Planning interactions
- Locating inputs/buttons/links reliably

**Important:** refs are not stable forever. Re-run snapshot after navigation or major DOM updates.

---

### `browser_click`
Click an element by ref from `browser_snapshot`.

**Input:**
- `ref` (e.g. `@e12`)
- optional `waitFor`: `none` (default), `navigation`, `network-idle`
- optional `timeoutMs`

---

### `browser_fill`
Type text into an input or textarea by ref.

**Input:** `ref`, `value`

---

### `browser_select`
Select option in a `<select>` by ref + option value.

**Input:** `ref`, `value`

---

### `browser_scroll`
Scroll page in a direction.

**Input:** `direction` (`up|down|left|right`), optional `amount`

---

### `browser_back` / `browser_forward`
Navigate browser history.

---

### `browser_evaluate`
Execute JavaScript expression in page context.

**Use when:**
- Extracting complex DOM data
- Reading computed values/styles
- Triggering advanced interactions not covered by click/fill/select

---

### `browser_screenshot`
Capture screenshot of current browser window content.

**Use when:**
- Visual confirmation
- Reviewing rendering/layout issues

**Note:** prefer `browser_snapshot` for interaction targeting.

---

### `browser_screenshot_region`
Capture only a specific region or element instead of the full viewport.

**Target modes:**
- Coordinates (`x`, `y`, `width`, `height`)
- Ref (`ref` from `browser_snapshot`, e.g. `@e12`)
- Selector (`selector` CSS query, e.g. `div[data-testid="chart"]`) — resolves to the **first visible match** (falls back to first DOM match)

**Optional:**
- `padding` to expand capture around target box

**Validation rules:**
- Provide exactly one mode: coordinates, `ref`, or `selector`
- Coordinate mode requires all four fields (`x`, `y`, `width`, `height`)
- `width` and `height` must be > 0 in coordinate mode

---

### `browser_console`
Get recent browser console messages from the active page.

**Input:** optional `level` (`all|log|info|warn|error`) and `limit`

**Use when:**
- Debugging runtime errors without opening DevTools
- Validating warnings after interactions

---

### `browser_window_resize`
Resize browser viewport to deterministic dimensions.

**Input:** `width`, `height` in pixels

**Use when:**
- Consistent screenshot framing
- Responsive layout checks

**Note:** returned dimensions represent the effective applied viewport after platform/window minimum constraints.

---

### `browser_network`
Inspect recent network request activity for the active page.

**Input:** optional `limit`, `status`, `method`, `resourceType`

**Use when:**
- Debugging failed API calls after interactions
- Understanding what requests a click/navigation triggered

---

### `browser_wait`
Wait for a page condition.

**Kinds:**
- `selector` (wait until selector exists)
- `text` (wait until text appears in page body)
- `url` (wait until URL contains substring)
- `network-idle` (wait until in-flight requests settle)

---

### `browser_key`
Send keyboard input to the active page.

**Input:** `key`, optional `modifiers` (`shift|control|alt|meta`)

---

### `browser_downloads`
Inspect download activity from the active page.

**Input:**
- `action`: `list` (default) or `wait`
- `limit` (for list)
- `timeoutMs` (for wait)

---

### Common validation errors
- `Provide exactly one target mode...` → You passed neither or multiple region target modes.
- `Coordinate mode requires x, y, width, and height together.` → One or more coordinate fields are missing.
- `Coordinate mode width and height must be greater than 0.` → Invalid region size.
- `Resolved screenshot region is outside the current viewport` → Scroll/navigate first or adjust coordinates/padding.

---

## End-to-end examples

### Example 1 — Open, navigate, inspect, click
```text
browser_open()
browser_navigate({ url: "https://example.com" })
browser_snapshot()
# find button ref, e.g. @e7
browser_click({ ref: "@e7" })
```

### Example 2 — Login form fill
```text
browser_open()
browser_navigate({ url: "https://app.example.com/login" })
browser_snapshot()
# fill email/password refs from snapshot
browser_fill({ ref: "@e3", value: "user@example.com" })
browser_fill({ ref: "@e5", value: "••••••••" })
browser_click({ ref: "@e6" })
```

### Example 3 — Extract custom data with evaluate
```text
browser_open()
browser_navigate({ url: "https://news.ycombinator.com" })
browser_evaluate({ expression: "Array.from(document.querySelectorAll('.titleline a')).slice(0,5).map(a => a.textContent)" })
```

### Example 4 — Recover stale refs
```text
# click fails because ref changed after navigation
browser_snapshot()   # refresh refs
browser_click({ ref: "@e11" })
```

---

## `browser-tool` helper CLI (secondary path)

Use the helper CLI to discover browser operations and get deterministic JSON templates:

```bash
bun run browser-tool --help
bun run browser-tool list
bun run browser-tool template browser_navigate
bun run browser-tool all-templates
```

The helper prints structured payload templates (`{ tool, input }`) that map to native `browser_*` tools.

### `browser_tool close`
Close and destroy the browser window entirely.

**Use when:**
- Task is fully complete and browser is no longer needed
- You want to clean up resources

**Effect:** Window is destroyed. All state (cookies, history within the window) is lost. Next `open` creates a fresh window.

### `browser_tool hide`
Hide the browser window but keep it alive in memory.

**Use when:**
- Temporarily done with the browser but may need it again
- Want to keep the page state (login, form data) for later

**Effect:** Window is hidden but preserved. `open` re-shows it instantly without reloading.

### Lifecycle guidance

| Command | When | Effect |
|---------|------|--------|
| `close` | Task fully complete, browser not needed | Destroys window |
| `release` | Agent done, user may want to keep browsing | Dismisses overlay, window stays visible |
| `hide` | Temporarily done, may need browser later | Hides window, preserves state |

---

## Behavior notes

- Browser tools are allowed in **Explore/Safe mode** by default.
- Before first browser tool usage, the agent must read this guide (`~/.craft-agent/docs/browser-tools.md`).
- Closing a browser window UI (via OS close button) **hides** it (keeps session/browser context alive).
- Use `browser_tool close` for explicit full teardown/reset.

## Troubleshooting

### "Browser window controls are not available"
The desktop browser manager isn’t wired for this runtime/session. Ensure you’re using the Electron desktop app and the session is initialized.

### "Element @eX not found"
Ref is stale. Run `browser_snapshot` again and use fresh refs.

### Input interactions are flaky
Ensure page is loaded and element is visible. Retry with:
`browser_open` → `browser_snapshot` → interaction.
