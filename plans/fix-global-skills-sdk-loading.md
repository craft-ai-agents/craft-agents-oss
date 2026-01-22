# Fix: Global Skills Not Loadable via @mention in Electron App

## Overview

Global skills from `~/.claude/skills/` and `~/.craft-agent/global-skills/` are visible in the UI but cannot be triggered via `@mentions` because the Claude Agent SDK only loads the workspace as a plugin.

## Problem Statement

**The Gap:**

| Component | Skills Loaded From |
|-----------|-------------------|
| **UI** (loadAllSkills) | Workspace + Global + Claude Code |
| **SDK** (plugins config) | Workspace only |

When a user types `@ralph-loop` in chat:
1. UI shows the skill (loaded from `~/.claude/skills/ralph-loop/`)
2. Message sent to SDK with `@ralph-loop` mention
3. SDK's Skill tool searches only in workspace plugins
4. Skill not found → agent doesn't receive skill instructions

**Affected Skills:** All 20+ skills in `~/.claude/skills/` including:
- ralph-loop, agent-browser, compound-docs, skill-creator, etc.

## Proposed Solution

Add global skill directories to the SDK plugins array in `craft-agent.ts`:

```typescript
// Before (line 1467)
plugins: [{ type: 'local' as const, path: this.workspaceRootPath }],

// After
plugins: [
  { type: 'local' as const, path: this.workspaceRootPath },
  ...(existsSync(GLOBAL_SKILLS_DIR) ? [{ type: 'local' as const, path: GLOBAL_SKILLS_DIR }] : []),
  ...(existsSync(CLAUDE_CODE_SKILLS_DIR) ? [{ type: 'local' as const, path: CLAUDE_CODE_SKILLS_DIR }] : []),
],
```

## Technical Approach

### Files to Modify

**Primary:** `packages/shared/src/agent/craft-agent.ts`
- Add imports for path constants and `existsSync`
- Modify the `plugins` array in the `chat()` method options (around line 1467)

### Implementation Details

#### 1. Add Imports

```typescript
// Add to existing imports at top of file
import { existsSync } from 'fs';
import { GLOBAL_SKILLS_DIR, CLAUDE_CODE_SKILLS_DIR } from '../config/paths.ts';
```

#### 2. Build Plugins Array with Safety Checks

```typescript
// Helper function (add near line 385, after workspaceRootPath getter)
private buildPluginConfigs(): Array<{ type: 'local'; path: string }> {
  const configs: Array<{ type: 'local'; path: string }> = [
    { type: 'local' as const, path: this.workspaceRootPath },
  ];

  // Add global skills directory if it exists
  if (existsSync(GLOBAL_SKILLS_DIR)) {
    configs.push({ type: 'local' as const, path: GLOBAL_SKILLS_DIR });
  }

  // Add Claude Code skills directory if it exists
  if (existsSync(CLAUDE_CODE_SKILLS_DIR)) {
    configs.push({ type: 'local' as const, path: CLAUDE_CODE_SKILLS_DIR });
  }

  debug(`[CraftAgent] Loading plugins from: ${configs.map(c => c.path).join(', ')}`);
  return configs;
}
```

#### 3. Use Helper in Options

```typescript
// Replace line 1467
plugins: this.buildPluginConfigs(),
```

### Priority Order

Match UI priority (workspace > global > claude-code):

1. **Workspace** (`{workspace}/skills/`) - Highest priority
2. **Global** (`~/.craft-agent/global-skills/`) - User-installed
3. **Claude Code** (`~/.claude/skills/`) - CLI-installed, lowest priority

This order ensures workspace skills override global skills with the same slug.

## Acceptance Criteria

### Functional Requirements

- [x] Skills from `~/.claude/skills/` can be triggered via `@skill-name` mention
- [x] Skills from `~/.craft-agent/global-skills/` can be triggered via `@skill-name` mention
- [x] Workspace skills still work and take priority over global skills
- [x] Session initialization succeeds when global directories don't exist
- [x] Session initialization succeeds when global directories are empty

### Non-Functional Requirements

- [ ] No noticeable delay in session initialization (<100ms added)
- [ ] Debug logging shows which plugin directories are loaded
- [ ] Error in one plugin directory doesn't break others

## Edge Cases Handled

| Edge Case | Handling |
|-----------|----------|
| `~/.claude/skills/` doesn't exist | Skip with `existsSync` check |
| `~/.craft-agent/global-skills/` doesn't exist | Skip with `existsSync` check |
| Permission denied on directory | `existsSync` returns false |
| Same skill slug in multiple locations | First plugin wins (workspace > global > claude-code) |
| Empty skill directories | SDK handles gracefully |
| Malformed SKILL.md | SDK handles per-skill errors |

## Testing Plan

### Manual Testing

1. **Verify @mention works for global skills:**
   - Ensure `~/.claude/skills/ralph-loop/` exists
   - Open Electron app, start new session
   - Type `@ralph-loop` in chat - should autocomplete
   - Submit message - skill instructions should be included

2. **Verify workspace priority:**
   - Create `{workspace}/skills/test-skill/SKILL.md`
   - Create `~/.claude/skills/test-skill/SKILL.md` with different content
   - Use `@test-skill` - workspace version should load

3. **Verify graceful handling:**
   - Remove `~/.craft-agent/global-skills/` directory
   - App should still start and workspace skills work

### Automated Tests (Future)

Location: `packages/shared/tests/craft-agent-plugins.test.ts`

```typescript
describe('buildPluginConfigs', () => {
  it('includes workspace path always');
  it('includes global skills dir when exists');
  it('includes claude code skills dir when exists');
  it('excludes directories that do not exist');
  it('maintains priority order');
});
```

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SDK rejects non-existent paths | Low | High | Use existsSync check |
| Performance regression | Low | Low | Directories scanned once at init |
| Breaking existing behavior | Low | Medium | Workspace priority preserved |
| SDK conflict resolution differs from UI | Medium | Low | Test and document behavior |

## References

### Internal References
- Plugin config: `packages/shared/src/agent/craft-agent.ts:1467`
- Path constants: `packages/shared/src/config/paths.ts:22-23`
- UI skill loading: `packages/shared/src/skills/storage.ts:236-256`
- SDK types: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1229-1238`

### External References
- [Claude Agent SDK Plugins](https://platform.claude.com/docs/en/agent-sdk/plugins)
- [Plugins Reference](https://code.claude.com/docs/en/plugins-reference)

## MVP Implementation

### craft-agent.ts

```typescript
// 1. Add imports (near top of file)
import { existsSync } from 'fs';
import { GLOBAL_SKILLS_DIR, CLAUDE_CODE_SKILLS_DIR } from '../config/paths.ts';

// 2. Add helper method (after line 385, after workspaceRootPath getter)
private buildPluginConfigs(): Array<{ type: 'local'; path: string }> {
  const configs: Array<{ type: 'local'; path: string }> = [
    { type: 'local' as const, path: this.workspaceRootPath },
  ];

  if (existsSync(GLOBAL_SKILLS_DIR)) {
    configs.push({ type: 'local' as const, path: GLOBAL_SKILLS_DIR });
  }

  if (existsSync(CLAUDE_CODE_SKILLS_DIR)) {
    configs.push({ type: 'local' as const, path: CLAUDE_CODE_SKILLS_DIR });
  }

  debug(`[CraftAgent] Loading plugins from: ${configs.map(c => c.path).join(', ')}`);
  return configs;
}

// 3. Update plugins in chat() options (replace line 1467)
plugins: this.buildPluginConfigs(),
```
