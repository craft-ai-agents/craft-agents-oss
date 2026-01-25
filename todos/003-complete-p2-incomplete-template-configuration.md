---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, features, templates, ux]
dependencies: []
---

# Problem Statement

**Incomplete Template Configuration Capture**

The `useTemplateSession` hook only applies `permissionMode` and `workingDirectory` from templates, ignoring other important configuration like `skillIds`, `model`, and `thinkingLevel`.

**Why This Matters:**
- Templates don't actually configure sessions as advertised
- Users will be confused when skills/model don't apply from template
- Feature is incomplete and misleading

## Findings

**Location:** `apps/electron/src/renderer/hooks/useTemplateSession.ts:10-31`

```typescript
export function useTemplateSession() {
  const createSessionFromTemplate = useCallback(
    async (template: SessionTemplate | null, baseOptions?: CreateSessionOptions): Promise<CreateSessionOptions> => {
      if (!template) {
        // No template, use base options or empty
        return baseOptions ?? {};
      }

      // Merge template configuration with base options (base options take precedence)
      const options: CreateSessionOptions = {
        permissionMode: baseOptions?.permissionMode ?? template.permissionMode,
        workingDirectory: baseOptions?.workingDirectory ?? template.workingDirectory,
        ...baseOptions,  // This spreads baseOptions AFTER, overriding everything
      };

      return options;
    },
    []
  );

  return { createSessionFromTemplate };
}
```

**Problems:**

1. **Missing Configuration Fields**
   - `skillIds` - Not applied to session
   - `model` - Not applied to session
   - `thinkingLevel` - Not applied to session

2. **Wrong Merge Order**
   - `...baseOptions` at the end overwrites all template values
   - Should be: template values first, then baseOptions override

3. **Type Mismatch**
   - `CreateSessionOptions` likely doesn't have all these fields
   - Need to verify `CreateSessionOptions` interface supports template fields

**Evidence from Template Types:**

```typescript
export interface SessionTemplate {
  // ... other fields
  skillIds?: string[];           // ← Not used
  permissionMode?: 'safe' | 'ask' | 'allow-all';  // ✓ Used
  model?: string;                // ← Not used
  thinkingLevel?: number;        // ← Not used
  workingDirectory?: string;     // ✓ Used
}
```

## Proposed Solutions

### Solution 1: Complete Template Application (Recommended)

**Apply all template configuration fields to the session.**

**Implementation:**

```typescript
// apps/electron/src/renderer/hooks/useTemplateSession.ts

export function useTemplateSession() {
  const createSessionFromTemplate = useCallback(
    async (template: SessionTemplate | null, baseOptions?: CreateSessionOptions): Promise<CreateSessionOptions> => {
      if (!template) {
        return baseOptions ?? {};
      }

      // Start with template configuration
      const options: CreateSessionOptions = {
        permissionMode: template.permissionMode,
        workingDirectory: template.workingDirectory,
        model: template.model,
        thinkingLevel: template.thinkingLevel,
        skillIds: template.skillIds,
        // Merge with baseOptions (baseOptions override template)
        ...baseOptions,
      };

      return options;
    },
    []
  );

  return { createSessionFromTemplate };
}
```

**But first, verify `CreateSessionOptions` supports these fields:**

```typescript
// apps/electron/src/shared/types.ts (need to check)

export interface CreateSessionOptions {
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  workingDirectory?: string;
  model?: string;              // Add if missing
  thinkingLevel?: number;      // Add if missing
  skillIds?: string[];         // Add if missing
  // ... other fields
}
```

**If fields are missing, add them to `CreateSessionOptions` and update `SessionManager.createSession()` to handle them.**

**Pros:**
- Complete feature implementation
- Templates work as users expect
- Consistent with template storage schema

**Cons:**
- May require changes to `SessionManager`
- Need to handle skill loading/attachment

**Effort:** Medium (3-5 hours)
**Risk:** Low (extends existing functionality)

### Solution 2: Document Limitations

**Keep current implementation but clearly document what templates don't include.**

**Pros:**
- No code changes
- Quick

**Cons:**
- Incomplete feature
- User confusion
- Technical debt

**Effort:** Small (30 minutes)
**Risk:** High (user dissatisfaction)

## Recommended Action

**Implement Solution 1 (Complete Template Application)**

Templates are a core feature. Shipping with incomplete configuration support will lead to bug reports and user frustration.

### Additional Investigation Needed:

1. **Check `CreateSessionOptions` interface:**
   ```bash
   grep -A 20 "interface CreateSessionOptions" apps/electron/src/shared/types.ts
   ```

2. **Check `SessionManager.createSession()` implementation:**
   ```bash
   grep -A 50 "createSession.*workspaceId" apps/electron/src/main/sessions.ts
   ```

3. **Verify skill attachment flow:**
   - How are skills normally attached to sessions?
   - Does `createSession` support `skillIds` parameter?
   - If not, need to attach skills after session creation

## Technical Details

**Affected Files:**
- `apps/electron/src/renderer/hooks/useTemplateSession.ts` (main fix)
- `apps/electron/src/shared/types.ts` (may need to extend `CreateSessionOptions`)
- `apps/electron/src/main/sessions.ts` (may need to update `createSession`)

**Related Components:**
- Session creation flow
- Skill attachment mechanism
- Model and thinking level configuration

**Database/Schema Changes:** None

## Acceptance Criteria

- [ ] Templates apply all configuration fields (skills, model, thinking level)
- [ ] `CreateSessionOptions` includes all template fields
- [ ] `SessionManager.createSession()` handles template fields
- [ ] Skills from template are loaded and attached to session
- [ ] Model and thinking level from template are applied
- [ ] baseOptions override template values when provided
- [ ] Add integration test: create session from template, verify all config applied
- [ ] Update PR description to mention complete template application

## Work Log

### 2026-01-25
- **Discovered:** Incomplete template application during code review
- **Analysis:** Only 2 of 5 configuration fields are applied
- **Impact:** Feature doesn't work as advertised
- **Investigation:** Need to check CreateSessionOptions and SessionManager
- **Recommendation:** Complete the implementation before merge
- **VERIFIED FIXED:** Complete template configuration implementation:
  - `useTemplateSession` now applies all fields: permissionMode, workingDirectory, model, thinkingLevel, skillIds (lines 19-27)
  - `CreateSessionOptions` interface includes all template fields (apps/electron/src/shared/types.ts:419-437)
  - Correct merge order: template values first, then baseOptions override (line 26)
  - Comment added noting skillIds handling at UI integration level (lines 29-32)

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **File:** `apps/electron/src/renderer/hooks/useTemplateSession.ts`
- **Related:** SessionManager, CreateSessionOptions interface
- **Pattern:** Check how skills are attached in new session dialog
