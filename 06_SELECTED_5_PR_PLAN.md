# Phase 6 — Selected 5 PR Plan

Selected based on: impact, effort, CI safety, and upstream activity.

---

## Selected PR #1: Fix missing `tsconfig.base.json` — unblock CI pipeline

**Issue**: Blocks `typecheck:all` → `validate:ci`  
**Type**: Infrastructure  
**Effort**: Low  
**Risk**: Very low (build config only)

### Files to change
- `tsconfig.base.json` (create at repo root)

### Implementation

**Step 1**: Examine existing tsconfig.json at root and one affected package to understand required fields:

```bash
cat tsconfig.json
cat packages/shared/tsconfig.json
```

**Step 2**: Create `tsconfig.base.json` with shared fields:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "lib": ["ESNext"],
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

**Step 3**: Verify:
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/oss-pr-campaign/repos/craft-agents-oss
bun run typecheck:all
```

**Step 4**: Run full CI:
```bash
bun run validate:ci
```

### Verification criteria
- `typecheck:all` passes
- `validate:ci` completes (may still fail on other pre-existing issues, but tsconfig must not be the cause)

---

## Selected PR #2: Fix sidebar label counts — close #761

**Issue**: Sidebar label counts incorrect (parent ≠ children sum, mismatch with API)  
**PR already open**: #786 `fix: correct sidebar label counts for hierarchical labels`  
**Type**: Bug fix  
**Effort**: Medium  
**Risk**: Low (small targeted fix)

### Investigation steps

**Step 1**: Find the counting logic:
```bash
grep -rn "label.*count\|count.*label\|sidebar" packages/shared/src/ --include="*.ts" | head -30
```

**Step 2**: Find API response handling:
```bash
grep -rn "parent.*label\|children.*label\|hierarchical" packages/shared/src/ --include="*.ts" | head -20
```

**Step 3**: Review PR #786 changes if accessible via gh:
```bash
gh pr view 786 --repo craft-ai-agents/craft-agents-oss --json files,title,body
```

### Fix approach
The bug is likely in label tree aggregation logic — parent count should be sum of visible children, but the current implementation either double-counts or misses hidden items.

### Verification
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/oss-pr-campaign/repos/craft-agents-oss
bun test packages/shared/src/config/__tests__/ 2>&1 | tail -20
```

---

## Selected PR #3: Fix vLLM/OpenAI "No response" false failure — close #783

**Issue**: OpenAI Compatible (vLLM) connection test falsely reports "No response from provider", but actual chat works  
**Type**: Bug fix  
**Effort**: Medium  
**Risk**: Low (probe/test code only)

### Investigation steps

**Step 1**: Find the connection test/probe code:
```bash
grep -rn "no.*response\|connection.*test\|probe" packages/shared/src/ --include="*.ts" -l | head -10
```

**Step 2**: Find vLLM/custom endpoint handling:
```bash
grep -rn "openai\|vllm\|custom.*endpoint\|compatible" packages/shared/src/ --include="*.ts" | head -20
```

**Step 3**: Examine the test request format vs actual working request

### Likely root cause
The probe sends a chat completions request with streaming=false, but vLLM may respond differently (SSE, or with different content-type). Or the probe expects a specific response shape that vLLM doesn't produce.

### Fix approach
1. Check what request format the probe sends
2. Compare with what actual working chat sends
3. Align probe to match successful request pattern

### Verification
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/oss-pr-campaign/repos/craft-agents-oss
bun test packages/shared/tests/llm-connections.test.ts 2>&1 | tail -20
```

---

## Selected PR #4: Telegram parallel sessions — /slash commands queue — close #793

**Issue**: Cannot do parallel Telegram sessions because /slash commands don't register until current turn is over  
**Type**: Bug fix  
**Effort**: Medium  
**Risk**: Medium (messaging gateway + automation routing)

### Investigation steps

**Step 1**: Find Telegram message handling:
```bash
grep -rn "telegram\|slash\|command" packages/messaging-gateway/src/ --include="*.ts" | head -30
```

**Step 2**: Find automation trigger/session routing:
```bash
grep -rn "PendingPrompt\|automation.*trigger\|session.*route" packages/shared/src/ --include="*.ts" | head -20
```

**Step 3**: Understand why slash commands block the turn

### Likely root cause
Slash command parsing is synchronous and blocks the message handling turn, preventing parallel session creation until the current turn completes.

### Fix approach
1. Make slash command parsing non-blocking (async) OR
2. Queue slash command intent separately from current turn processing

### Verification
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /root/oss-pr-campaign/repos/craft-agents-oss
bun test packages/messaging-gateway/ 2>&1 | tail -20
```

---

## Selected PR #5: Mobile WebUI button crowding — close #798

**Issue**: Long custom provider model names cause button crowding on mobile WebUI and hide send button  
**Type**: Bug fix (UI)  
**Effort**: Low  
**Risk**: Very low (CSS/styling only)

### Investigation steps

**Step 1**: Find model selector / provider dropdown in WebUI:
```bash
find apps/webui packages/ui -name "*.tsx" | xargs grep -l "model\|provider" | head -10
```

**Step 2**: Find mobile-specific styles:
```bash
grep -rn "mobile\|max-width\|@media" apps/webui/src/ --include="*.css" --include="*.tsx" | head -20
```

### Fix approach
1. Add text-overflow: ellipsis + max-width to model name buttons
2. Add flex-wrap or overflow handling for mobile viewports
3. Ensure send button stays visible with z-index or flex order

### Verification
Manual test in browser devtools mobile view (no automated test for this specific UI issue).

---

## Summary Table

| # | PR | Issue | Effort | Risk | Confidence |
|---|----|-------|--------|------|------------|
| 1 | Fix tsconfig.base.json | CI blocked | Low | Very Low | High |
| 2 | Sidebar label counts | #761 | Medium | Low | High (PR #786 exists) |
| 3 | vLLM false failure | #783 | Medium | Low | Medium |
| 4 | Telegram parallel | #793 | Medium | Medium | Medium |
| 5 | Mobile button crowding | #798 | Low | Very Low | High |

---

## Out of Scope (for this batch)

- **#807** (Markdown preview/browser rendering) — high complexity, Electron-specific
- **#781** (Traditional Chinese i18n) — PR already submitted, needs review, not authored here
- **#744/#789** (symlinked skill dirs) — already merged
- **#804/#805** (source_activated stall) — already merged

---

## Notes

- All PRs should include tests where applicable
- Run `bun run validate:ci` before submitting to confirm tsconfig fix doesn't break other things
- PR #1 must land first — it unblocks the CI pipeline for all other PRs