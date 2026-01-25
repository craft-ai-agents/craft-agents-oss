---
status: complete
priority: p3
issue_id: "005"
tags: [code-review, validation, data-integrity, templates]
dependencies: []
---

# Problem Statement

**Missing Validation for Template Scope and Workspace Consistency**

Templates can be created with inconsistent scope/workspaceId combinations, leading to orphaned templates and confusing UX.

**Why This Matters:**
- Global templates shouldn't have workspaceId
- Workspace templates must have workspaceId
- Inconsistent data makes cleanup difficult
- Could lead to templates not appearing where expected

## Findings

### Issue 1: No Validation in `createTemplate`

**Location:** `packages/shared/src/templates/storage.ts:63-77`

```typescript
export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,  // ← No validation that scope matches workspaceId
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };
  // ...
}
```

**Problems:**
- Can create global template with workspaceId set
- Can create workspace template without workspaceId
- No validation of workspaceId format (should be UUID)

### Issue 2: Inconsistent Handling in `getTemplatesDir`

**Location:** `packages/shared/src/templates/storage.ts:11-17`

```typescript
export function getTemplatesDir(scope: 'global' | 'workspace', workspaceId?: string): string {
  if (scope === 'global') {
    return join(VESPER_DIR, 'templates');
  }
  if (!workspaceId) throw new Error('workspaceId required for workspace scope');
  return join(VESPER_DIR, 'workspaces', workspaceId, 'templates');
}
```

**Good:** Throws error if workspace scope without workspaceId.
**Problem:** Doesn't validate if global scope has unexpected workspaceId.

### Issue 3: UI Doesn't Prevent Invalid Combinations

**Location:** `apps/electron/src/renderer/components/templates/CreateTemplateDialog.tsx:135-159`

```typescript
function CreateTemplateFromScratchDialog() {
  const [scope, setScope] = useState<'workspace' | 'global'>('workspace');

  const handleSave = async () => {
    await onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      scope,
      workspaceId: scope === 'workspace' ? workspaceId : undefined,  // ✓ Good!
    });
  };
}
```

**Good:** UI correctly omits workspaceId for global templates.
**Problem:** No validation that template was saved to correct location.

## Proposed Solutions

### Solution 1: Add Validation to Storage Layer (Recommended)

**Add validation function to ensure scope/workspaceId consistency.**

**Implementation:**

```typescript
// packages/shared/src/templates/storage.ts

/**
 * Validates template scope and workspaceId consistency
 */
function validateTemplateScope(scope: 'global' | 'workspace', workspaceId?: string): void {
  if (scope === 'global' && workspaceId) {
    throw new Error('Global templates cannot have a workspaceId');
  }
  if (scope === 'workspace' && !workspaceId) {
    throw new Error('Workspace templates must have a workspaceId');
  }
  if (workspaceId) {
    // Validate UUID format (simple check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(workspaceId)) {
      throw new Error('Invalid workspaceId format (must be UUID)');
    }
  }
}

export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  // Validate scope consistency
  validateTemplateScope(options.scope, options.workspaceId);

  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  // ... rest of function
}

export async function updateTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId: string | undefined,
  updates: Partial<SessionTemplate>
): Promise<SessionTemplate | null> {
  const template = await getTemplate(id, scope, workspaceId);
  if (!template) return null;

  // Prevent changing scope or workspaceId
  if (updates.scope && updates.scope !== template.scope) {
    throw new Error('Cannot change template scope after creation');
  }
  if (updates.workspaceId !== undefined && updates.workspaceId !== template.workspaceId) {
    throw new Error('Cannot change template workspaceId after creation');
  }

  const updated: SessionTemplate = {
    ...template,
    ...updates,
    id: template.id,
    scope: template.scope,  // Preserve scope
    workspaceId: template.workspaceId,  // Preserve workspaceId
    createdAt: template.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const dir = getTemplatesDir(scope, workspaceId);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(updated, null, 2));

  return updated;
}
```

**Pros:**
- Prevents invalid data at source
- Clear error messages
- Protects scope/workspaceId from modification

**Cons:**
- Slightly more code
- Need to handle validation errors in UI

**Effort:** Small (1-2 hours)
**Risk:** Low (validation only)

### Solution 2: Add Migration Script for Cleanup

**If templates with invalid scope/workspaceId exist, provide cleanup script.**

**Implementation:**

```typescript
// packages/shared/src/templates/migrate.ts

export async function cleanupInvalidTemplates(): Promise<{
  fixed: number;
  errors: Array<{ id: string; error: string }>;
}> {
  const fixed = 0;
  const errors = [];

  // Check global templates
  const globalDir = join(homedir(), '.vesper', 'templates');
  const globalFiles = await readdir(globalDir);

  for (const file of globalFiles) {
    if (file.endsWith('.json')) {
      const content = await readFile(join(globalDir, file), 'utf-8');
      const template = JSON.parse(content);

      // Fix global templates with workspaceId
      if (template.scope === 'global' && template.workspaceId) {
        delete template.workspaceId;
        await writeFile(join(globalDir, file), JSON.stringify(template, null, 2));
        fixed++;
      }
    }
  }

  // Check workspace templates (similar logic)

  return { fixed, errors };
}
```

**Effort:** Medium (2-3 hours)
**Risk:** Low

## Recommended Action

**Implement Solution 1 (Validation)**

Prevent invalid data from being created in the first place. This is a new feature, so there's no legacy data to worry about.

**Skip Solution 2 (Migration)** - Not needed since feature is new.

## Technical Details

**Affected Files:**
- `packages/shared/src/templates/storage.ts` (validation function)
- `apps/electron/src/main/templates.ts` (error handling for validation failures)

**Validation Rules:**
1. Global templates: `scope === 'global'` AND `workspaceId === undefined`
2. Workspace templates: `scope === 'workspace'` AND `workspaceId` is valid UUID
3. Cannot change scope after creation
4. Cannot change workspaceId after creation

## Acceptance Criteria

- [ ] Cannot create global template with workspaceId
- [ ] Cannot create workspace template without workspaceId
- [ ] workspaceId must be valid UUID format
- [ ] Cannot change scope via `updateTemplate`
- [ ] Cannot change workspaceId via `updateTemplate`
- [ ] Add unit tests for validation function
- [ ] Error messages clearly explain what's wrong

## Work Log

### 2026-01-25
- **Discovered:** Missing scope/workspaceId validation during code review
- **Analysis:** Could lead to orphaned or misplaced templates
- **Severity:** P3 (data integrity issue, but unlikely to occur with current UI)
- **Recommendation:** Add validation to prevent future issues
- **VERIFIED FIXED:** Scope validation implemented:
  - `validateScopeConsistency` function validates scope/workspaceId consistency (lines 30-37)
  - Called in `validateTemplateOptions` for template creation (line 49)
  - Called in `updateTemplate` to validate updates (lines 208-210)
  - Prevents global templates from having workspaceId
  - Requires workspace templates to have workspaceId
  - Clear error messages for validation failures

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **File:** `packages/shared/src/templates/storage.ts`
- **Pattern:** Similar validation in workspace creation, skill installation
