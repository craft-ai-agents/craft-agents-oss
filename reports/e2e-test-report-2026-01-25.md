# E2E Test Report - Vesper Recent Features

**Date:** 2026-01-25
**Environment:** macOS Darwin 24.6.0
**Electron Version:** Built from source
**Test Framework:** CDP (Chrome DevTools Protocol)

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total Test Suites** | 6 |
| **Total Tests** | 84 |
| **Passed** | 45 (53.6%) |
| **Failed** | 33 (39.3%) |
| **Skipped** | 6 (7.1%) |
| **Total Duration** | ~10.5s |

### Overall Status: ⚠️ PARTIAL PASS

The E2E tests revealed that several IPC methods documented in CLAUDE.md are not yet exposed via `electronAPI`. This indicates either:
1. The preload bridge needs updating to expose these methods
2. The feature implementations exist but aren't wired to the renderer process
3. Method names differ from documentation

---

## Test Results by Feature

### 1. Skills Marketplace

| Status | Tests |
|--------|-------|
| ✅ Passed | 7 |
| ❌ Failed | 3 |
| ⏭️ Skipped | 0 |

**Passed Tests:**
- CDP Connection
- `marketplaceSearch` exists
- `marketplaceInstall` exists
- Search returns results (50 skills)
- Query search works ("git")
- Skills page accessible
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `marketplaceGetSkillInfo` exists | Method not exposed in electronAPI |
| Skill has required properties | Missing `description` field |
| Get skill info | `marketplaceGetSkillInfo is not a function` |

**Recommendation:** Expose `marketplaceGetSkillInfo` in preload bridge. Update skill schema to include `description`.

---

### 2. Terminal Resume Button

| Status | Tests |
|--------|-------|
| ✅ Passed | 9 |
| ❌ Failed | 1 |
| ⏭️ Skipped | 0 |

**Passed Tests:**
- CDP Connection
- Session ID validation (rejects invalid)
- Valid UUID format accepted
- Short hex format accepted
- Working directory handling
- TaskListId parameter support
- Button visibility check
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `spawnTerminal` exists | Method not exposed in electronAPI |

**Recommendation:** Expose `spawnTerminal` IPC handler in preload bridge. The backend `terminal.ts` exists but isn't connected.

---

### 3. Session Labels

| Status | Tests |
|--------|-------|
| ✅ Passed | 6 |
| ❌ Failed | 5 |
| ⏭️ Skipped | 3 |

**Passed Tests:**
- CDP Connection
- `createLabel` exists
- `updateLabel` exists
- `deleteLabel` exists
- Settings navigation
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `getLabels` exists | Method not exposed |
| Get active workspace | `getConfig is not a function` |
| `getLabels` returns array | Method not exposed |
| Create label | Workspace ID is null |
| Color validation | Depends on workspace ID |

**Root Cause:** `getConfig` is not exposed in electronAPI, causing workspace ID to be null.

**Recommendation:** Expose `getConfig` and `getLabels` in preload bridge.

---

### 4. Scheduler Session Continuation

| Status | Tests |
|--------|-------|
| ✅ Passed | 8 |
| ❌ Failed | 5 |
| ⏭️ Skipped | 3 |

**Passed Tests:**
- CDP Connection
- `scheduleCreate` exists
- `scheduleUpdate` exists
- `scheduleDelete` exists
- `scheduleList` exists
- List returns array (0 schedules)
- Settings navigation
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `scheduleGet` exists | Method not exposed |
| Get active workspace | `getConfig is not a function` |
| Create schedule | Workspace ID is null |
| Cron schedule | Workspace ID is null |
| Execution history | Workspace ID is null |

**Root Cause:** Same as Labels - `getConfig` not exposed.

**Recommendation:** Expose `getConfig` and `scheduleGet` in preload bridge.

---

### 5. Viewer Backend Abstraction

| Status | Tests |
|--------|-------|
| ✅ Passed | 4 |
| ❌ Failed | 11 |
| ⏭️ Skipped | 0 |

**Passed Tests:**
- CDP Connection
- `getViewerConfig` exists
- `setViewerConfig` exists
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `viewerShare` exists | Not exposed |
| `viewerUpdate` exists | Not exposed |
| `viewerRevoke` exists | Not exposed |
| `viewerHealthCheck` exists | Not exposed |
| Config returns type field | Config structure different |
| craft-hosted config | Config update failed |
| static-export config | Config update failed |
| Health check | Not a function |
| Share structure | Not a function |
| Update structure | Not a function |
| Revoke structure | Not a function |

**Root Cause:** Viewer service methods not wired to IPC handlers.

**Recommendation:** Create IPC handlers in main process for all viewer operations and expose in preload.

---

### 6. WhatsApp Integration

| Status | Tests |
|--------|-------|
| ✅ Passed | 11 |
| ❌ Failed | 8 |
| ⏭️ Skipped | 0 |

**Passed Tests:**
- CDP Connection
- `whatsappConnect` exists
- `whatsappDisconnect` exists
- `whatsappGetStatus` exists
- `whatsappSendMessage` exists
- Groups API handles disconnected state
- Event listener patterns
- Message validation
- Settings navigation
- Screenshot captured

**Failed Tests:**
| Test | Error |
|------|-------|
| `whatsappGetGroups` exists | Not exposed |
| `whatsappGetRouteConfig` exists | Not exposed |
| `whatsappSetRouteConfig` exists | Not exposed |
| Get active workspace | `getConfig is not a function` |
| Status returns object | Missing connection field |
| Connection status valid | undefined |
| Route config returns | Not a function |
| Route config update | Not a function |

**Recommendation:** Expose remaining WhatsApp methods and fix status return structure.

---

## Screenshots Captured

All screenshots saved to `/tmp/vespr-e2e/`:

| Suite | Screenshot |
|-------|------------|
| Skills Marketplace | `skills-marketplace.png` |
| Terminal Resume | `terminal-resume.png` |
| Session Labels | `session-labels-settings.png` |
| Scheduler | `scheduler-continuation.png` |
| Viewer Backend | `viewer-backend.png` |
| WhatsApp | `whatsapp-integration.png` |

---

## Priority Fixes Required

### Critical (Blocking Multiple Tests)

1. **Expose `getConfig` in electronAPI**
   - Impacts: Labels, Scheduler, WhatsApp tests
   - Location: `apps/electron/src/preload/index.ts`

### High Priority

2. **Expose missing IPC methods:**
   - `getLabels`
   - `scheduleGet`
   - `spawnTerminal`
   - `marketplaceGetSkillInfo`
   - All `viewer*` methods
   - `whatsappGetGroups`, `whatsappGetRouteConfig`, `whatsappSetRouteConfig`

### Medium Priority

3. **Fix data structures:**
   - Skills: Add `description` field
   - WhatsApp status: Return proper `{ connection: 'open'|'close'|'connecting' }` structure

---

## Preload Bridge Methods Status

| Method | Status | Feature |
|--------|--------|---------|
| `marketplaceSearch` | ✅ Exposed | Skills |
| `marketplaceInstall` | ✅ Exposed | Skills |
| `marketplaceGetSkillInfo` | ❌ Missing | Skills |
| `spawnTerminal` | ❌ Missing | Terminal |
| `getLabels` | ❌ Missing | Labels |
| `createLabel` | ✅ Exposed | Labels |
| `updateLabel` | ✅ Exposed | Labels |
| `deleteLabel` | ✅ Exposed | Labels |
| `getConfig` | ❌ Missing | Core |
| `scheduleCreate` | ✅ Exposed | Scheduler |
| `scheduleUpdate` | ✅ Exposed | Scheduler |
| `scheduleDelete` | ✅ Exposed | Scheduler |
| `scheduleList` | ✅ Exposed | Scheduler |
| `scheduleGet` | ❌ Missing | Scheduler |
| `getViewerConfig` | ✅ Exposed | Viewer |
| `setViewerConfig` | ✅ Exposed | Viewer |
| `viewerShare` | ❌ Missing | Viewer |
| `viewerUpdate` | ❌ Missing | Viewer |
| `viewerRevoke` | ❌ Missing | Viewer |
| `viewerHealthCheck` | ❌ Missing | Viewer |
| `whatsappConnect` | ✅ Exposed | WhatsApp |
| `whatsappDisconnect` | ✅ Exposed | WhatsApp |
| `whatsappGetStatus` | ✅ Exposed | WhatsApp |
| `whatsappSendMessage` | ✅ Exposed | WhatsApp |
| `whatsappGetGroups` | ❌ Missing | WhatsApp |
| `whatsappGetRouteConfig` | ❌ Missing | WhatsApp |
| `whatsappSetRouteConfig` | ❌ Missing | WhatsApp |

**Total: 16 Exposed, 11 Missing**

---

## Test Infrastructure

The E2E test framework is working correctly:
- CDP connection established successfully
- Test runner executing all suites
- Screenshots captured for all features
- Results properly aggregated

### Running Tests

```bash
# Start Electron with CDP
npx electron --remote-debugging-port=9222 apps/electron

# Run all tests
bun run test:e2e

# Run individual suites
bun run test:e2e:skills
bun run test:e2e:terminal
bun run test:e2e:labels
bun run test:e2e:scheduler
bun run test:e2e:viewer
bun run test:e2e:whatsapp
```

---

## Conclusion

The E2E tests successfully identified gaps between the documented API surface and actual implementation. The core test infrastructure is solid, but the preload bridge needs updates to expose several IPC methods. Once the missing methods are exposed, the test pass rate should increase significantly.

### Next Steps

1. Update `apps/electron/src/preload/index.ts` to expose missing methods
2. Verify IPC handlers exist in `apps/electron/src/main/ipc.ts`
3. Re-run E2E tests after fixes
4. Add more edge case tests once core APIs are working

---

*Report generated automatically by Vesper E2E Test Suite*
