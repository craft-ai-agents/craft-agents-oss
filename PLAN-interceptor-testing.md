# Test Plan: Cache TTL Interceptor (Implemented)

**File Under Test:** `src/cache-ttl-interceptor.ts`
**Branch:** `feature/add-interceptor-testing`
**Status:** Implemented

---

## Implementation Summary

This plan was implemented by extracting pure functions to a separate utils file with no side effects, following the standard pattern for testing modules that patch globals.

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/cache-ttl-utils.ts` | Pure utility functions (NEW) |
| `src/cache-ttl-interceptor.ts` | Imports from utils (MODIFIED) |
| `src/__tests__/cache-ttl.test.ts` | Unit tests importing from utils |
| `scripts/test-interceptor-smoke.ts` | Smoke tests for interceptor proxy |
| `.github/workflows/test.yml` | CI workflow |

### Commands

```bash
# Run all tests (unit + smoke)
bun run test

# Run only unit tests
bun test

# Run only smoke tests
bun scripts/test-interceptor-smoke.ts

# Type check
bun run typecheck
```

---

## Architecture: Separating Pure from Effectful Code

### The Problem

The interceptor patches `globalThis.fetch` at module load time via `bunfig.toml` preload. This makes testing challenging because:

1. Importing the interceptor triggers side effects
2. Tests can't spy on fetch before the interceptor captures it
3. Copied functions would drift from actual implementation

### The Solution

**Extract pure functions to a separate utils file with NO side effects.**

```
src/
├── cache-ttl-utils.ts      # Pure functions (addCacheTtl, isOpusModel, etc.)
├── cache-ttl-interceptor.ts # Side effects (imports from utils, patches fetch)
└── __tests__/
    └── cache-ttl.test.ts   # Imports from utils - no side effects!
```

This pattern ensures:
- Tests import the **same code** that production uses
- Changes to `addCacheTtl()` are immediately tested
- No function duplication or drift between test and production

### Why This Works

1. `cache-ttl-utils.ts` exports pure functions with **zero imports** that have side effects
2. `cache-ttl-interceptor.ts` imports from utils, then patches fetch
3. Tests import from utils directly - no fetch patching triggered
4. When interceptor runs in production, it uses the exact same utils functions

---

## Files Detail

### `src/cache-ttl-utils.ts` (Pure, No Side Effects)

```typescript
/**
 * Pure utility functions for cache TTL manipulation.
 * NO side effects - safe to import in tests.
 */

export function addCacheTtl(obj: unknown): unknown { ... }
export function isOpusModel(model: string): boolean { ... }
export function isAnthropicMessagesUrl(url: string): boolean { ... }
```

### `src/cache-ttl-interceptor.ts` (Has Side Effects)

```typescript
import { addCacheTtl, isAnthropicMessagesUrl, isOpusModel } from './cache-ttl-utils';

// Side effects happen here
const originalFetch = globalThis.fetch.bind(globalThis);
// ... fetch patching code ...
(globalThis as any).fetch = fetchProxy;
```

### `src/__tests__/cache-ttl.test.ts`

```typescript
// Import from utils - NO side effects!
import { addCacheTtl, isOpusModel, isAnthropicMessagesUrl } from '../cache-ttl-utils';

describe('addCacheTtl', () => { ... });
describe('isOpusModel', () => { ... });
describe('isAnthropicMessagesUrl', () => { ... });
```

---

## Test Coverage

### Unit Tests (22 tests)

| Function | Tests |
|----------|-------|
| `addCacheTtl` | 18 tests covering ephemeral handling, nested structures, arrays, edge cases |
| `isOpusModel` | 2 tests for opus/non-opus models |
| `isAnthropicMessagesUrl` | 2 tests for URL matching |

### Smoke Tests (4 tests)

| Test | Purpose |
|------|---------|
| Interceptor installed | Verify `globalThis.fetch` is a Proxy |
| Non-Anthropic passthrough | Requests to other URLs pass unchanged |
| GET passthrough | Non-POST requests handled correctly |
| Malformed body | Invalid JSON doesn't crash |

---

## CI Workflow

### `.github/workflows/test.yml`

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test
      - run: bun scripts/test-interceptor-smoke.ts
      - run: bun run typecheck
```

---

## What This Doesn't Cover (And Why)

| Not Tested | Reason |
|------------|--------|
| `getExtendedCacheConfig()` | Reads filesystem at load time; manual testing sufficient |
| Config variations | Would need process isolation per config state |
| Actual API calls | Can't verify caching worked server-side |
| TTL injection E2E | URL matching prevents localhost testing |

---

## Manual Testing Checklist

For significant changes, manually verify:

- [ ] App starts: `bun start`
- [ ] Debug shows cache status: `bun start --debug` → check `/tmp/craft-debug.log`
- [ ] Opus models use 1h cache (auto mode)
- [ ] Non-Opus use 5m cache (auto mode)
- [ ] `"extendedCacheTtl": true` forces 1h for all
- [ ] `"extendedCacheTtl": false` disables for all

---

## Research Sources

This approach was informed by:
- [Bun Mocks Documentation](https://bun.sh/docs/test/mocks) - Module mocking patterns
- [Vitest Mocking Guide](https://vitest.dev/guide/mocking) - `vi.resetModules()` pattern
- [@mswjs/interceptors](https://github.com/mswjs/interceptors) - Low-level network interception patterns
- Standard practice: Separate pure functions from effectful code for testability
