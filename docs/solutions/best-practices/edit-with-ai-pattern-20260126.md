---
module: Vesper
date: 2026-01-26
problem_type: best_practice
component: frontend_stimulus
symptoms:
  - "Need to add AI-powered editing to a new feature"
  - "Want natural language configuration for user settings"
  - "Need conversational UI for complex form inputs"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
severity: medium
tags: [edit-with-ai, editpopover, session-scoped-tools, design-pattern, ai-powered-editing]
---

# Design Pattern: Edit with AI

## Overview

The "Edit with AI" pattern enables natural language editing of any Vesper feature through a consistent, reusable architecture. Users type requests like "change the time to 3pm" or "update the prompt to include weather" and AI handles the parsing and execution.

**Use cases:**
- Scheduler: Edit schedules with natural language
- Templates: Create/modify session templates conversationally
- Sources: Add new MCP servers or APIs via description
- Skills: Create skills from natural language descriptions
- Permissions: Configure rules through conversation

## Architecture

```
User types in EditPopover
        ↓
Opens Focused Chat Window (vesper://action/new-chat?...)
        ↓
AI Agent receives context + session-scoped tool
        ↓
Agent parses natural language, asks clarifying questions
        ↓
Agent calls session-scoped tool (e.g., schedule_update)
        ↓
VesperAgent callback → Main Process IPC
        ↓
Feature service executes action
        ↓
Broadcasts event to UI
```

## Implementation Checklist

To add "Edit with AI" to a new feature, implement these 5 components:

### 1. Add EditContext Key (`EditPopover.tsx`)

Location: `apps/electron/src/renderer/components/ui/EditPopover.tsx`

```typescript
// Add to EditContextKey type
export type EditContextKey =
  | 'existing-keys'
  | 'edit-your-feature'  // Add your key

// Add configuration to EDIT_CONFIGS
'edit-your-feature': (location) => ({
  context: {
    label: 'Edit Your Feature',
    filePath: location,  // JSON string with current state
    context:
      'The user is editing [feature]. Parse their request and use the ' +
      'your_feature_update tool. Current state is provided below. ' +
      'Ask clarifying questions if the request is ambiguous.',
  },
  example: 'Change the setting to X',
  overridePlaceholder: 'How would you like to change this?',
}),
```

### 2. Create Session-Scoped Tool (`session-scoped-tools.ts`)

Location: `packages/shared/src/agent/session-scoped-tools.ts`

```typescript
// Define data types
export interface YourFeatureUpdateData {
  featureId: string;
  // Optional update fields
  name?: string;
  setting?: string;
}

export interface YourFeatureUpdateResult {
  success: boolean;
  featureId?: string;
  featureName?: string;
  error?: string;
}

// Add callback to SessionScopedToolCallbacks
export interface SessionScopedToolCallbacks {
  // ... existing callbacks
  onYourFeatureUpdate?: (data: YourFeatureUpdateData) => Promise<YourFeatureUpdateResult>;
}

// Create the tool
export function createYourFeatureUpdateTool(sessionId: string) {
  return tool(
    'your_feature_update',
    `Update an existing [feature].

**Required:** featureId
**Optional fields:** name, setting, etc.

Always confirm changes with the user before updating.`,
    {
      featureId: z.string().describe('ID of the feature to update'),
      name: z.string().optional().describe('New name'),
      setting: z.string().optional().describe('New setting value'),
    },
    async (args) => {
      const callbacks = sessionScopedToolCallbackRegistry.get(sessionId);
      if (!callbacks?.onYourFeatureUpdate) {
        return {
          content: [{ type: 'text' as const, text: 'Feature update not available.' }],
          isError: true,
        };
      }
      const result = await callbacks.onYourFeatureUpdate(args);
      // Return formatted result
    }
  );
}

// Register in getSessionScopedTools()
cached = createSdkMcpServer({
  tools: [
    // ... existing tools
    createYourFeatureUpdateTool(sessionId),
  ],
});
```

### 3. Add VesperAgent Callback (`vesper-agent.ts`)

Location: `packages/shared/src/agent/vesper-agent.ts`

```typescript
// Add callback property
public onYourFeatureUpdate: ((data: YourFeatureUpdateData) => Promise<YourFeatureUpdateResult>) | null = null;

// Wire up in registerSessionScopedToolCallbacks
registerSessionScopedToolCallbacks(sessionId, {
  // ... existing callbacks
  onYourFeatureUpdate: async (data) => {
    if (this.onYourFeatureUpdate) {
      return this.onYourFeatureUpdate(data);
    }
    return { success: false, error: 'Not available' };
  },
});
```

### 4. Implement Main Process Handler (`sessions.ts`)

Location: `apps/electron/src/main/sessions.ts`

```typescript
// Wire up the callback when session is created
managed.agent.onYourFeatureUpdate = async (data): Promise<YourFeatureUpdateResult> => {
  try {
    const service = getYourFeatureService(managed.workspace.id);
    const result = await service.update(data.featureId, {
      name: data.name,
      setting: data.setting,
    });
    return {
      success: true,
      featureId: result.id,
      featureName: result.name,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
```

### 5. Add UI Button with EditPopover

Location: Your feature's detail panel component

```tsx
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { Sparkles } from 'lucide-react'

// Build context with current state
const editConfig = useMemo(() => {
  const context = JSON.stringify({
    featureId: feature.id,
    name: feature.name,
    setting: feature.setting,
  })
  return getEditConfig('edit-your-feature', context)
}, [feature])

// Render button
{workspaceId && (
  <EditPopover
    trigger={
      <Button size="sm" variant="outline" className="gap-2">
        <Sparkles className="w-3 h-3" />
        Edit with AI
      </Button>
    }
    context={editConfig.context}
    example={editConfig.example}
    overridePlaceholder={editConfig.overridePlaceholder}
    workspaceId={workspaceId}
  />
)}
```

## Key Files Reference

| Component | File |
|-----------|------|
| EditPopover + Context Registry | `apps/electron/src/renderer/components/ui/EditPopover.tsx` |
| Session-Scoped Tools | `packages/shared/src/agent/session-scoped-tools.ts` |
| VesperAgent Callbacks | `packages/shared/src/agent/vesper-agent.ts` |
| Agent Package Exports | `packages/shared/src/agent/index.ts` |
| Session Manager | `apps/electron/src/main/sessions.ts` |

## Existing Implementations

Reference these for examples:

| Feature | Context Key | Tool | Added |
|---------|-------------|------|-------|
| Create Schedule | `add-schedule` | `schedule_create` | Original |
| Edit Schedule | `edit-schedule` | `schedule_update` | 2026-01-26 |
| Add Template | `add-template` | - (file-based) | Original |
| Add Source | `add-source` | `source_test` | Original |
| Add Skill | `add-skill` | `skill_validate` | Original |

## Best Practices

1. **Context includes current state**: Pass all relevant current values so AI knows what's being edited

2. **Ask clarifying questions**: The AI context should instruct the agent to ask if requests are ambiguous

3. **Confirm before executing**: Always have the agent confirm changes with the user before calling the tool

4. **Provide good examples**: The `example` field in EditConfig helps users understand what to type

5. **Secondary action for advanced**: Include a secondary action button for users who prefer manual forms

```tsx
<EditPopover
  secondaryAction={{
    label: 'Advanced',
    onClick: () => setShowAdvancedModal(true),
  }}
/>
```

6. **Handle missing callbacks gracefully**: Always check if callback exists before calling

## Related Patterns

- **EditPopover**: Generic popover for natural language input
- **Session-Scoped Tools**: Tools available only within agent sessions
- **Deep Links**: `vesper://` protocol for opening focused chat windows

## Related Issues

No related issues documented yet.
