# Phase 5 — PR Candidates

Generated from: issue triage, quality audit, and codebase analysis.

---

## Candidate 1: Fix missing `tsconfig.base.json` — unblock CI

**Type**: Build/Infrastructure  
**Priority**: 🔴 Critical  
**Effort**: Low  
**Source**: Quality Audit (Phase 5)

### Problem
`packages/session-tools-core`, `packages/session-mcp-server`, and `packages/pi-agent-server` all `extends: "../../tsconfig.base.json"` which doesn't exist. This blocks `typecheck:all` → `validate:ci` entirely.

### Approach
Create `tsconfig.base.json` at repo root with base compiler options compatible with the monorepo structure:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext"],
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true
  }
}
```

Or update the 3 packages to extend from `../../tsconfig.json` instead.

### Files to change
- `tsconfig.base.json` (create)  
  OR
- `packages/session-tools-core/tsconfig.json`
- `packages/session-mcp-server/tsconfig.json`
- `packages/pi-agent-server/tsconfig.json`
- `packages/pi-agent-server/tsconfig.typecheck.json`

---

## Candidate 2: Fix sidebar label counts (parent ≠ children sum) — #761

**Type**: Bug fix  
**Priority**: 🟡 Medium  
**Effort**: Medium  
**Source**: Issue #761, PR #786 ready  
**Labels**: bug

### Problem
Sidebar shows incorrect label counts — parent count doesn't equal sum of children, and counts don't match the API.

### PR status
PR #786 `fix: correct sidebar label counts for hierarchical labels` is open and appears to address this.

### Files likely involved
- `packages/shared/src/config/` or `packages/shared/src/sessions/` (counting logic)
- `packages/ui/` (rendering)

---

## Candidate 3: Fix vLLM/OpenAI Compatible "No response" false failure — #783

**Type**: Bug fix  
**Priority**: 🟡 Medium  
**Effort**: Medium  
**Source**: Issue #783  
**Labels**: bug

### Problem
OpenAI Compatible (vLLM) connection test falsely reports "No response from provider" even though actual chat works perfectly.

### Root cause hint
Issue is in the connection probe/test logic — it likely sends a non-streaming request or expects a different response format than what vLLM returns.

### Files likely involved
- `packages/shared/src/sources/` (source test/connection logic)
- `packages/shared/src/config/llm-connections.ts`

---

## Candidate 4: Telegram parallel sessions — /slash commands don't take until turn is over — #793

**Type**: Bug fix  
**Priority**: 🟡 Medium  
**Effort**: Medium  
**Source**: Issue #793  
**Labels**: bug

### Problem
Cannot do parallel Telegram sessions because `/slash` commands don't register until the current turn is over.

### Files likely involved
- `packages/messaging-gateway/` (Telegram handler)
- `packages/server-core/src/handlers/` (automation/session routing)

---

## Candidate 5: Add Traditional Chinese (zh-Hant) locale support — PR #781

**Type**: i18n / Feature  
**Priority**: 🟢 Nice-to-have  
**Effort**: Low  
**Source**: PR #781, Issue #717  
**Repo**: Already submitted as PR

### Problem
i18n issue #717 flagged multiple hardcoded English strings. PR #781 adds Traditional Chinese translation.

### Status
PR #781 `feat(i18n): add Traditional Chinese (zh-Hant) locale support` is open and needs review.

### Files
- `packages/shared/src/i18n/locales/zh-Hant.json` (create, copy from zh-Hans)
- `packages/shared/src/i18n/registry.ts` (add locale to registry)

---

## Candidate 6: Sidebar label counts fix (PR #786 already exists)

**Type**: Bug fix  
**Priority**: 🟡 Medium  
**Effort**: Low  
**Source**: PR #786 already submitted

Already tracked in Candidate 2. PR is open and ready for merge review.

---

## Candidate 7: Session title language should respect user preferences — #738

**Type**: Feature  
**Priority**: 🟢 Nice-to-have  
**Effort**: Medium  
**Source**: Issue #738

### Problem
Session titles are generated in a fixed language regardless of user i18n preference.

### Files likely involved
- `packages/shared/src/utils/title-generator.ts`
- `packages/shared/src/config/` (user preferences)

---

## Candidate 8: Mobile WebUI button crowding — #798

**Type**: Bug fix (UI)  
**Priority**: 🟡 Medium  
**Effort**: Low  
**Source**: Issue #798

### Problem
Long custom provider model names cause button crowding on mobile WebUI and hide the send button.

### Files likely involved
- `packages/ui/src/components/` (chat input components)
- `apps/webui/` (mobile responsive styles)

---

## Candidate 9: Compact / configurable chat input box height — #749

**Type**: Feature  
**Priority**: 🟢 Nice-to-have  
**Effort**: Medium  
**Source**: Issue #749

### Files likely involved
- `packages/ui/` (chat input / textarea components)
- `packages/shared/src/config/preferences.ts`

---

## Candidate 10: macOS Dock icon changes appearance after launch — #737

**Type**: Bug fix (platform)  
**Priority**: 🟢 Low  
**Effort**: Medium  
**Source**: Issue #737  
**Labels**: bug

### Problem
macOS Dock icon changes appearance after launch (likely related to Electron window/app icon).

### Files likely involved
- `apps/electron/src/main/` (app lifecycle, icon handling)

---

## Candidate 11: Zoom level resets when switching away — #780

**Type**: Bug fix  
**Priority**: 🟢 Low  
**Effort**: Low  
**Source**: Issue #780

### Problem
Cmd+Plus zoom not persisted — resets when switching away from app and back.

### Files likely involved
- `apps/electron/src/main/` (window state persistence)
- `packages/shared/src/config/preferences.ts`

---

## Candidate 12: Automations "Run test" RPC timeout — #736

**Type**: Bug fix  
**Priority**: 🟡 Medium  
**Effort**: Medium  
**Source**: Issue #736

### Problem
Automations "Run test" can hit RPC timeout while the prompt run still succeeds (false timeout).

### Files likely involved
- `packages/server-core/src/handlers/rpc/` (RPC timeout logic)
- `packages/shared/src/automations/` (automation execution)