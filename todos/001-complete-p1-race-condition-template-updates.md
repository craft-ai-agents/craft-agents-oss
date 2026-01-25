---
status: complete
priority: p1
issue_id: "001"
tags: [code-review, concurrency, data-integrity, templates]
dependencies: []
---

# Problem Statement

**Race Condition in Template Storage Updates**

The `incrementUsageCount` function in `packages/shared/src/templates/storage.ts` has a critical race condition that can lead to data loss when multiple sessions use the same template concurrently.

**Why This Matters:**
- Users lose accurate usage tracking
- Popular templates will have incorrect usage counts
- Could lead to data corruption if template is updated while usage count is being incremented

## Findings

**Location:** `packages/shared/src/templates/storage.ts:125-137`

```typescript
export async function incrementUsageCount(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const template = await getTemplate(id, scope, workspaceId);  // Read
  if (template) {
    template.usageCount = (template.usageCount || 0) + 1;      // Modify
    template.updatedAt = new Date().toISOString();
    const dir = getTemplatesDir(scope, workspaceId);
    await writeFile(join(dir, `${id}.json`), JSON.stringify(template, null, 2));  // Write
  }
}
```

**Race Condition Scenario:**
1. Session A reads template (usageCount: 5)
2. Session B reads template (usageCount: 5)
3. Session A increments to 6, writes file
4. Session B increments to 6, writes file
5. **Result: usageCount is 6 instead of 7**

**Additional Issue:**
The `updateTemplate` function has the same read-modify-write pattern (lines 93-114), which could conflict with concurrent usage count updates.

## Proposed Solutions

### Solution 1: File-Based Locking (Recommended)

**Pros:**
- Simple, works across processes
- Minimal dependencies (use `proper-lockfile` npm package)
- Transparent to consumers

**Cons:**
- Slight performance overhead
- Requires cleanup on crashes (lockfile handles this)

**Implementation:**
```typescript
import lockfile from 'proper-lockfile';

export async function incrementUsageCount(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);

  const release = await lockfile.lock(filePath, {
    stale: 5000,
    retries: { retries: 5, minTimeout: 50 }
  });

  try {
    const template = await getTemplate(id, scope, workspaceId);
    if (template) {
      template.usageCount = (template.usageCount || 0) + 1;
      template.updatedAt = new Date().toISOString();
      await writeFile(filePath, JSON.stringify(template, null, 2));
    }
  } finally {
    await release();
  }
}
```

**Effort:** Medium (2-4 hours)
**Risk:** Low (well-tested library)

### Solution 2: Atomic Update via Rename

**Pros:**
- No external dependencies
- Atomic filesystem operations

**Cons:**
- More complex implementation
- Still needs coordination for read-modify-write

**Implementation:**
```typescript
export async function incrementUsageCount(
  id: string,
  scope: 'global' | 'workspace',
  workspaceId?: string
): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  const filePath = join(dir, `${id}.json`);
  const tempPath = join(dir, `.${id}.tmp.json`);

  // Read current state
  const template = await getTemplate(id, scope, workspaceId);
  if (template) {
    template.usageCount = (template.usageCount || 0) + 1;
    template.updatedAt = new Date().toISOString();

    // Write to temp file, then atomic rename
    await writeFile(tempPath, JSON.stringify(template, null, 2));
    await rename(tempPath, filePath);
  }
}
```

**Effort:** Small (1-2 hours)
**Risk:** Medium (filesystem edge cases)

### Solution 3: In-Memory Counter with Periodic Flush

**Pros:**
- Best performance
- No contention

**Cons:**
- Counters lost on crash
- More complex state management
- Requires background flushing

**Effort:** Large (4-8 hours)
**Risk:** High (complexity, state management)

## Recommended Action

**Implement Solution 1 (File-Based Locking)**

This is the safest and most reliable approach. The performance overhead is negligible for template operations, and `proper-lockfile` handles edge cases like stale locks and process crashes.

**Also apply locking to `updateTemplate`** to prevent conflicts between user edits and usage tracking.

## Technical Details

**Affected Files:**
- `packages/shared/src/templates/storage.ts`
  - Lines 93-114: `updateTemplate` function
  - Lines 125-137: `incrementUsageCount` function

**Database/Schema Changes:** None

**Dependencies:**
- Add `proper-lockfile` to `packages/shared/package.json`

## Acceptance Criteria

- [ ] `incrementUsageCount` uses file locking
- [ ] `updateTemplate` uses file locking
- [ ] Concurrent calls to `incrementUsageCount` on same template result in correct count
- [ ] Concurrent update + increment operations don't lose data
- [ ] Stale locks are cleaned up after process crash
- [ ] Add unit tests for concurrent access

## Work Log

### 2026-01-25
- **Discovered:** Race condition in template storage during code review
- **Analysis:** Confirmed read-modify-write pattern without synchronization
- **Research:** Evaluated locking strategies (file locks, atomic ops, in-memory)
- **Recommendation:** File-based locking with proper-lockfile
- **VERIFIED FIXED:** File locking with `proper-lockfile` implemented in:
  - `incrementUsageCount` (lines 278-309) - Uses lock with retry mechanism
  - `updateTemplate` (lines 201-250) - Uses lock with retry mechanism
  - Stale lock cleanup: 5000ms timeout
  - Retry strategy: 5 retries with 50ms minimum timeout
  - Proper cleanup in finally blocks

## Resources

- **PR:** https://github.com/AskTinNguyen/vesper/pull/2
- **File:** `packages/shared/src/templates/storage.ts`
- **Library:** https://github.com/moxystudio/node-proper-lockfile
- **Pattern:** Similar to scheduler CRUD operations which use file locks
