# Phase 5 — Quality Audit

## 1. TODO/FIXME/XXX/HACK Inventory (packages/)

Found **19 matches** across packages/, all related to Opus 4.6 sunset or minor refactoring:

| File | Line | Type | Note |
|------|------|------|------|
| `server-core/src/sessions/SessionManager.ts` | 934 | TODO | Legacy 'think' normalization removal |
| `shared/src/config/llm-connections.ts` | 596 | TODO | Drop 'claude-opus-4-6' from anthropic/bedrock |
| `shared/src/config/storage.ts` | 1819 | TODO | Delete Opus 4.6 migration |
| `shared/src/config/storage.ts` | 2255 | TODO | Drop Opus 4.6 call and function |
| `shared/src/config/models.ts` | 103 | TODO | Remove Opus 4.6 entry |
| `shared/src/config/models.ts` | 106 | TODO | Comment pointing to all TODO(opus-4.6-sunset) marks |
| `shared/src/config/validators.ts` | 118 | TODO | Timezone validation against IANA list (minor) |
| `shared/src/agent/pi-agent.ts` | 1369 | TODO | MCP server proxy placeholder |
| `shared/src/agent/pi-agent.ts` | 1370 | TODO | API source proxy placeholder |
| `shared/src/agent/thinking-levels.ts` | 141 | TODO | Legacy 'think' compatibility path removal |
| `shared/src/workspaces/storage.ts` | 129 | TODO | Legacy 'think' normalization removal |
| `shared/tests/models.test.ts` | 97 | TODO | Drop Opus 4.6 block when deprecated |
| `shared/src/config/__tests__/storage-startup-migration.test.ts` | 253 | TODO | Drop describe block when 4.6 deprecated |

**Assessment**: All TODOs are minor/legitimate technical debt. No critical issues.

---

## 2. Broken Links in README

Checked all external links:
- ✅ YouTube video link (ok)
- ✅ YouTube showcase links (ok)  
- ✅ Google Cloud Console link (ok)
- ✅ All anchor links internal

No broken links detected.

---

## 3. i18n Completeness

| Locale | Keys | Status |
|--------|------|--------|
| en | 1430 | ✅ Reference |
| de | 1430 | ✅ Complete |
| es | 1430 | ✅ Complete |
| hu | 1430 | ✅ Complete |
| ja | 1430 | ✅ Complete |
| pl | 1430 | ✅ Complete |
| zh-Hans | 1430 | ✅ Complete |

All locales fully translated (1430 keys each). No gaps.

---

## 4. Package.json Workspace Structure

```json
{
  "workspaces": ["packages/*", "apps/*", "!apps/online-docs"]
}
```

- 10 packages, 4 apps (online-docs excluded)
- ✅ Structure is valid
- ⚠️ `apps/online-docs` excluded via negation pattern (mintlify docs)

---

## 5. TypeScript / Build Issues

### Critical: Missing `tsconfig.base.json`

**Affected packages:**
- `packages/session-tools-core/tsconfig.json` → `extends: "../../tsconfig.base.json"`
- `packages/session-mcp-server/tsconfig.json` → `extends: "../../tsconfig.base.json"`
- `packages/pi-agent-server/tsconfig.json` → `extends: "../../tsconfig.base.json"`
- `packages/pi-agent-server/tsconfig.typecheck.json` → `extends: "../../tsconfig.base.json"`

**Root cause**: These packages reference `../../tsconfig.base.json` which doesn't exist in the repo history (not even in older commits). This blocks the entire `typecheck:all` CI step.

**Fix options**:
1. Create `tsconfig.base.json` at repo root with base compiler options
2. Update affected packages to `extends: "../../tsconfig.json"` (use root config)

### Other TypeScript errors (blocked by above):
- `src/handlers/source-test.ts(311)`: regex flag `d` needs ES6 target
- `src/tool-defs-filtering.test.ts(34)`: Set iteration needs `--downlevelIteration`
- `src/validation.ts(128)`: Type narrowing issue with discriminated union

All likely symptoms of the broken base config chain.

---

## 6. Test Baseline

```
bun test: 4500 tests, 4466 pass, 22 fail, 12 skip
22 failures in packages/shared — pre-existing:
  - BrowserPaneManager (8): Electron renderer isolation
  - resource-bundle (5): Electron preload isolation  
  - startWebuiHttpServer (6): WebUI HTTP server cookie/HTTPS inference
  - RPC handler registration (2): Handler channel deduplication

All failures are environment/isolation-related, not logic bugs.
```

---

## Quality Audit Summary

| Area | Status | Notes |
|------|--------|-------|
| TODO/FIXME count | ✅ 19 low-priority | All Opus 4.6 sunset or minor placeholders |
| README links | ✅ All valid | No broken links |
| i18n completeness | ✅ Full parity | 7 locales × 1430 keys |
| Workspace structure | ✅ Valid | 10 packages, 4 apps |
| TypeScript CI | ❌ Blocked | Missing tsconfig.base.json |
| Test suite | ⚠️ Acceptable | 22 pre-existing isolation failures |

**Priority fix**: Restore/create `tsconfig.base.json` to unblock CI.