---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, architecture, consistency]
dependencies: []
---

# Missing `agentationEnabled` in Config Defaults Schema

## Problem Statement

The `agentationEnabled` setting is not defined in `ConfigDefaults` interface or `BUNDLED_CONFIG_DEFAULTS`, breaking the established pattern used by other settings like `notificationsEnabled`.

**Why this matters:** Inconsistent patterns make the codebase harder to maintain and the default value harder to discover/modify via config files.

## Findings

### Architecture Agent Finding
- **File:** `packages/shared/src/config/config-defaults-schema.ts`
- **Evidence:** `notificationsEnabled` follows the full pattern (interface + bundled default + config fallback), but `agentationEnabled` only has a hardcoded fallback in the getter.

### Current Implementation (Inconsistent)
```typescript
// storage.ts:261-267
export function getAgentationEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.agentationEnabled !== undefined) {
    return config.agentationEnabled;
  }
  return false; // Hardcoded default - INCONSISTENT
}
```

### Expected Pattern (notificationsEnabled)
```typescript
// storage.ts:238-245
export function getNotificationsEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.notificationsEnabled !== undefined) {
    return config.notificationsEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.notificationsEnabled; // Uses config defaults
}
```

## Proposed Solutions

### Option 1: Add to Config Defaults Schema (Recommended)
**Description:** Add `agentationEnabled` to the ConfigDefaults interface and BUNDLED_CONFIG_DEFAULTS.

**Changes needed:**
1. In `config-defaults-schema.ts`:
```typescript
defaults: {
  authType: AuthType;
  notificationsEnabled: boolean;
  agentationEnabled: boolean;  // Add this
  colorTheme: string;
};
```

2. In BUNDLED_CONFIG_DEFAULTS:
```typescript
defaults: {
  authType: 'api_key',
  notificationsEnabled: true,
  agentationEnabled: false,  // Add this
  colorTheme: 'default',
},
```

3. Update getter in storage.ts:
```typescript
export function getAgentationEnabled(): boolean {
  const config = loadStoredConfig();
  if (config?.agentationEnabled !== undefined) {
    return config.agentationEnabled;
  }
  const defaults = loadConfigDefaults();
  return defaults.defaults.agentationEnabled;
}
```

**Pros:**
- Follows established pattern
- Default is configurable via config-defaults.json
- Consistent with other settings

**Cons:**
- More files to change

**Effort:** Small
**Risk:** Low

### Option 2: Document the Exception
**Description:** Keep the hardcoded default but add a comment explaining why.

**Pros:**
- No code changes needed

**Cons:**
- Pattern remains inconsistent
- Default not configurable

**Effort:** Trivial
**Risk:** Low

## Recommended Action

_To be filled during triage_

## Technical Details

### Affected Files
- `packages/shared/src/config/config-defaults-schema.ts`
- `packages/shared/src/config/storage.ts`
- `apps/electron/resources/config-defaults.json` (optional)

## Acceptance Criteria

- [ ] `agentationEnabled` defined in ConfigDefaults interface
- [ ] Default value in BUNDLED_CONFIG_DEFAULTS
- [ ] Getter uses loadConfigDefaults() for fallback
- [ ] Pattern matches notificationsEnabled implementation

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-01-23 | Created from code review | Pattern consistency important for maintainability |

## Resources

- Related file: `packages/shared/src/config/config-defaults-schema.ts`
- Pattern reference: `getNotificationsEnabled()` implementation
