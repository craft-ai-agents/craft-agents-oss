---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, error-handling, reliability, templates]
dependencies: []
---

# Problem Statement

**Critical Missing Error Handling in Template Storage Operations**

Several template storage functions silently fail or return incomplete results without proper error handling, leading to confusing UX and potential data loss.

**Why This Matters:**
- Users don't know when template operations fail (save, delete, update)
- Silent failures lead to confusion and lost work
- No rollback mechanism for partial failures
- Debugging production issues is impossible without error context

## Findings

### Issue 1: Silent Failure in `deleteTemplate`

**Location:** `packages/shared/src/templates/storage.ts:116-123`

```typescript
export async function deleteTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  await unlink(join(dir, `${id}.json`));  // Throws if file doesn't exist
}
```

**Problem:** If template file doesn't exist, throws ENOENT error. No validation that template exists first.

### Issue 2: No Error Propagation in `loadTemplatesFromDir`

**Location:** `packages/shared/src/templates/storage.ts:19-42`

```typescript
async function loadTemplatesFromDir(dir: string, scope: 'global' | 'workspace'): Promise<SessionTemplate[]> {
  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);
    const templates: SessionTemplate[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const template = JSON.parse(content) as SessionTemplate;
          templates.push(template);
        } catch (error) {
          console.error(`Failed to load template ${file}:`, error);  // Silent fail
        }
      }
    }

    return templates;
  } catch (error) {
    console.error(`Failed to load templates from ${dir}:`, error);  // Silent fail
    return [];
  }
}
```

**Problems:**
- Corrupt JSON files are silently skipped
- Users have no way to know templates failed to load
- No mechanism to repair or report corrupt files

### Issue 3: Missing Validation in `createTemplate` and `updateTemplate`

**Location:** `packages/shared/src/templates/storage.ts:63-77, 93-114`

```typescript
export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  const dir = getTemplatesDir(options.scope, options.workspaceId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2));  // No error handling

  return template;
}
```

**Problems:**
- No validation of template name (empty, too long, invalid chars)
- No check for disk space before writing
- No validation of scope/workspaceId consistency
- File write failures not caught or reported

### Issue 4: Missing File System Error Handling in Main Process

**Location:** `apps/electron/src/main/templates.ts:35-105`

IPC handlers directly call storage functions without wrapping in try-catch. Any error will crash the handler and show cryptic error to user.

## Proposed Solutions

### Solution 1: Comprehensive Error Handling with User Feedback (Recommended)

**Add proper error handling, validation, and user feedback across all operations.**

**Implementation:**

```typescript
// packages/shared/src/templates/storage.ts

export class TemplateError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'IO_ERROR' | 'CORRUPT_DATA',
    public details?: unknown
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

// Validation helper
function validateTemplateOptions(options: CreateTemplateOptions): void {
  if (!options.name || options.name.trim().length === 0) {
    throw new TemplateError('Template name is required', 'INVALID_INPUT');
  }
  if (options.name.length > 100) {
    throw new TemplateError('Template name too long (max 100 chars)', 'INVALID_INPUT');
  }
  if (options.scope === 'workspace' && !options.workspaceId) {
    throw new TemplateError('Workspace ID required for workspace-scoped template', 'INVALID_INPUT');
  }
}

export async function createTemplate(options: CreateTemplateOptions): Promise<SessionTemplate> {
  validateTemplateOptions(options);

  const template: SessionTemplate = {
    id: uuidv4(),
    ...options,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usageCount: 0,
  };

  try {
    const dir = getTemplatesDir(options.scope, options.workspaceId);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, `${template.id}.json`);

    // Check if file already exists (shouldn't happen with UUID, but be safe)
    if (existsSync(filePath)) {
      throw new TemplateError('Template already exists', 'INVALID_INPUT');
    }

    await writeFile(filePath, JSON.stringify(template, null, 2));
    return template;
  } catch (error) {
    if (error instanceof TemplateError) throw error;

    throw new TemplateError(
      'Failed to create template',
      'IO_ERROR',
      { originalError: error }
    );
  }
}

export async function deleteTemplate(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);

  try {
    // Check if template exists first
    if (!existsSync(filePath)) {
      throw new TemplateError('Template not found', 'NOT_FOUND', { id, scope });
    }

    await unlink(filePath);
  } catch (error) {
    if (error instanceof TemplateError) throw error;

    throw new TemplateError(
      'Failed to delete template',
      'IO_ERROR',
      { id, scope, originalError: error }
    );
  }
}

async function loadTemplatesFromDir(
  dir: string,
  scope: 'global' | 'workspace'
): Promise<{ templates: SessionTemplate[]; errors: TemplateError[] }> {
  const templates: SessionTemplate[] = [];
  const errors: TemplateError[] = [];

  try {
    await mkdir(dir, { recursive: true });
    const files = await readdir(dir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await readFile(join(dir, file), 'utf-8');
          const template = JSON.parse(content) as SessionTemplate;

          // Validate template structure
          if (!template.id || !template.name || !template.scope) {
            throw new Error('Invalid template structure');
          }

          templates.push(template);
        } catch (error) {
          errors.push(
            new TemplateError(
              `Failed to load template ${file}`,
              'CORRUPT_DATA',
              { file, error }
            )
          );
        }
      }
    }
  } catch (error) {
    errors.push(
      new TemplateError(
        `Failed to read templates directory`,
        'IO_ERROR',
        { dir, error }
      )
    );
  }

  return { templates, errors };
}
```

**IPC Handler Updates:**

```typescript
// apps/electron/src/main/templates.ts

ipcMain.handle('template:create', async (_, options: CreateTemplateOptions) => {
  try {
    return await templateStorage.createTemplate(options);
  } catch (error) {
    console.error('Failed to create template:', error);
    throw error;  // Let renderer handle the error
  }
});

ipcMain.handle('template:delete', async (_, id: string, scope: 'global' | 'workspace', workspaceId?: string) => {
  try {
    await templateStorage.deleteTemplate(id, scope, workspaceId);
  } catch (error) {
    if (error instanceof templateStorage.TemplateError && error.code === 'NOT_FOUND') {
      // Template already deleted, treat as success
      return;
    }
    console.error('Failed to delete template:', error);
    throw error;
  }
});
```

**Pros:**
- Clear error messages for users
- Proper error categorization for debugging
- Validation prevents invalid data
- Graceful degradation for corrupt files

**Cons:**
- More code to maintain
- Breaking change to return type of `loadTemplatesFromDir`

**Effort:** Medium (4-6 hours)
**Risk:** Low (improves reliability)

### Solution 2: Minimal Error Handling (Quick Fix)

**Just wrap IPC handlers in try-catch and show generic errors.**

**Pros:**
- Quick to implement
- Prevents crashes

**Cons:**
- Poor UX (generic errors)
- No validation
- Hard to debug

**Effort:** Small (1-2 hours)
**Risk:** Low

## Recommended Action

**Implement Solution 1 (Comprehensive Error Handling)**

This PR introduces a new storage system. Getting error handling right from the start prevents technical debt and improves user experience significantly.

## Technical Details

**Affected Files:**
- `packages/shared/src/templates/storage.ts` (all functions)
- `apps/electron/src/main/templates.ts` (all IPC handlers)
- `apps/electron/src/renderer/atoms/templates.ts` (error state handling)
- `apps/electron/src/renderer/components/templates/*.tsx` (error display)

**Database/Schema Changes:** None

**Dependencies:** None (use built-in Error class)

## Acceptance Criteria

- [ ] All storage functions validate inputs before operations
- [ ] All file operations wrapped in try-catch with specific error messages
- [ ] `deleteTemplate` checks existence before attempting delete
- [ ] `loadTemplatesFromDir` returns both templates and errors
- [ ] IPC handlers catch and log errors properly
- [ ] UI displays helpful error messages (not "undefined" or stack traces)
- [ ] Add error handling tests for each storage function
- [ ] Document error codes and recovery procedures

## Work Log

### 2026-01-25
- **Discovered:** Missing error handling during code review
- **Analysis:** Identified 4 critical areas lacking error handling
- **Impact:** Could lead to crashes, data loss, poor UX
- **Recommendation:** Comprehensive error handling with validation
- **VERIFIED FIXED:** Comprehensive error handling implemented:
  - Custom `TemplateError` class with error codes (lines 16-25)
  - Validation in `createTemplate` with `validateTemplateOptions` (lines 42-50)
  - `deleteTemplate` checks existence before unlinking (lines 252-276)
  - `loadTemplatesFromDir` returns both templates and errors (lines 63-108)
  - All IPC handlers wrap calls in try-catch with proper logging (templates.ts)
  - Validation prevents invalid inputs and provides clear error messages

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **File:** `packages/shared/src/templates/storage.ts`
- **Pattern:** Follow error handling in `packages/shared/src/sessions/storage.ts`
- **Related:** Issue #001 (race conditions - should be fixed together)
