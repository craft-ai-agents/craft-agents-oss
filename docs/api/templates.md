# Session Templates API

**Last Updated:** 2026-01-26
**Package:** `@vesper/shared/templates`
**Version:** 1.0

Session Templates provide reusable session configuration presets with optional initial prompts, skill selection, and gather context instructions.

## Storage

- **Global:** `~/.vesper/templates/{uuid}.json` (one file per template)
- **Workspace:** `~/.vesper/workspaces/{id}/templates/{uuid}.json` (one file per template)
- **Concurrency:** File-based locking with `proper-lockfile` (5 retries, 50ms timeout)
- **File format:** JSON with pretty-print (2 spaces)

## Data Types

### SessionTemplate

```typescript
interface SessionTemplate {
  id: string;                    // UUID
  name: string;                  // Max 100 characters
  description?: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;          // Required for workspace-scoped templates

  // Session configuration
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;                // e.g., 'claude-sonnet-4-20250514'
  thinkingLevel?: number;        // 0-5
  workingDirectory?: string;
  skillIds?: string[];
  taskListId?: string;           // Optional task list for multi-agent coordination

  // Prompts and context gathering
  initialPrompt?: string;        // Pre-filled in input (not auto-sent)
  gatherContext?: string;        // Instructions for Claude about what to ask user

  // Usage tracking
  usageCount?: number;           // Incremented on each use

  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
}
```

### CreateTemplateOptions

```typescript
interface CreateTemplateOptions {
  name: string;                  // Required, max 100 chars
  description?: string;
  scope: 'global' | 'workspace'; // Required
  workspaceId?: string;          // Required if scope is 'workspace'
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  thinkingLevel?: number;        // 0-5
  workingDirectory?: string;
  skillIds?: string[];
  taskListId?: string;
  initialPrompt?: string;
  gatherContext?: string;        // Instructions for Claude
}
```

### SaveSessionAsTemplateOptions

```typescript
interface SaveSessionAsTemplateOptions {
  sessionId: string;
  name: string;
  description?: string;
  scope: 'global' | 'workspace';
  includeInitialPrompt: boolean;
}
```

## IPC Handlers

### `template:list`

List templates by scope.

**Request:**
```typescript
{
  scope: 'global' | 'workspace' | 'all';
  workspaceId?: string;  // Required for workspace/all scopes
}
```

**Response:**
```typescript
SessionTemplate[]
```

**Example:**
```typescript
// List all templates for current workspace
const templates = await ipcRenderer.invoke('template:list', 'all', workspaceId);

// List only global templates
const globalTemplates = await ipcRenderer.invoke('template:list', 'global');

// List only workspace templates
const workspaceTemplates = await ipcRenderer.invoke('template:list', 'workspace', workspaceId);
```

---

### `template:create`

Create a new template.

**Request:**
```typescript
CreateTemplateOptions
```

**Response:**
```typescript
SessionTemplate
```

**Example:**
```typescript
const template = await ipcRenderer.invoke('template:create', {
  name: 'Code Review',
  description: 'Template for reviewing pull requests',
  scope: 'workspace',
  workspaceId: 'workspace-1',
  permissionMode: 'ask',
  skillIds: ['review-pr', 'test-browser'],
  initialPrompt: 'Review the latest PR and check for issues'
});
```

---

### `template:get`

Get a template by ID.

**Request:**
```typescript
{
  id: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;  // Required for workspace scope
}
```

**Response:**
```typescript
SessionTemplate
```

**Example:**
```typescript
const template = await ipcRenderer.invoke(
  'template:get',
  'template-123',
  'workspace',
  workspaceId
);
```

---

### `template:update`

Update an existing template.

**Request:**
```typescript
{
  id: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;
  updates: Partial<SessionTemplate>;
}
```

**Response:**
```typescript
SessionTemplate
```

**Example:**
```typescript
const updated = await ipcRenderer.invoke(
  'template:update',
  'template-123',
  'workspace',
  workspaceId,
  {
    name: 'Updated Name',
    skillIds: ['new-skill-1', 'new-skill-2']
  }
);
```

---

### `template:delete`

Delete a template. Idempotent (returns success if not found).

**Request:**
```typescript
{
  id: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;
}
```

**Response:**
```typescript
void
```

**Example:**
```typescript
await ipcRenderer.invoke('template:delete', 'template-123', 'workspace', workspaceId);
```

---

### `template:save-from-session`

Save a session as a template (extracts configuration from live session).

**Request:**
```typescript
SaveSessionAsTemplateOptions
```

**Response:**
```typescript
SessionTemplate
```

**Example:**
```typescript
const template = await ipcRenderer.invoke('template:save-from-session', {
  sessionId: 'session-123',
  name: 'My Workflow',
  description: 'Saved from successful session',
  scope: 'workspace',
  includeInitialPrompt: true  // Extract first user message
});
```

**Extracted Fields:**
- `permissionMode`: From session
- `model`: From session
- `thinkingLevel`: From session
- `workingDirectory`: From session
- `skillIds`: From session skills
- `initialPrompt`: First user message (if `includeInitialPrompt` is true)

---

### `template:use`

Use a template (increments usage count).

**Request:**
```typescript
{
  templateId: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;
}
```

**Response:**
```typescript
SessionTemplate
```

**Example:**
```typescript
const template = await ipcRenderer.invoke(
  'template:use',
  'template-123',
  'workspace',
  workspaceId
);

// Now create session with template configuration
const session = await ipcRenderer.invoke('sessions:create', workspaceId, {
  permissionMode: template.permissionMode,
  model: template.model,
  thinkingLevel: template.thinkingLevel,
  workingDirectory: template.workingDirectory,
  skillIds: template.skillIds,
  taskListId: template.taskListId
});

// Optionally send initial prompt
if (template.initialPrompt) {
  await ipcRenderer.invoke('sessions:sendMessage', session.id, template.initialPrompt);
}
```

---

### `template:create-defaults`

Create default templates for a workspace (called when user enables templates).

**Request:**
```typescript
{
  workspaceId: string;
}
```

**Response:**
```typescript
SessionTemplate[]
```

**Example:**
```typescript
const defaultTemplates = await ipcRenderer.invoke('template:create-defaults', workspaceId);
```

**Default Templates Created:**
1. **Code Review** - Safe mode with review prompt
2. **Feature Build** - Allow-all with thinking level 3, gather context
3. **Bug Investigation** - Safe mode with investigation prompt, gather context
4. **Documentation** - Ask mode with gather context
5. **Refactoring** - Ask mode with thinking level 3, gather context
6. **Quick Question** - Safe mode with thinking level 0

Only creates templates if workspace has none. Returns empty array if templates already exist.

---

## Error Handling

All handlers throw `TemplateError` with error codes:

- `NOT_FOUND`: Template not found
- `INVALID_INPUT`: Invalid parameters
- `IO_ERROR`: File system error
- `CORRUPT_DATA`: Invalid JSON or schema

**Example:**
```typescript
try {
  await ipcRenderer.invoke('template:get', 'invalid-id', 'global');
} catch (error) {
  if (error.code === 'NOT_FOUND') {
    console.log('Template not found');
  }
}
```

---

## Usage Patterns

### Creating Sessions from Templates

```typescript
// 1. Browse and select template
const templates = await ipcRenderer.invoke('template:list', 'all', workspaceId);
const selected = templates.find(t => t.name === 'Code Review');

// 2. Use template (increments usage count)
const template = await ipcRenderer.invoke('template:use', selected.id, selected.scope, workspaceId);

// 3. Create session with template config
const session = await createSessionFromTemplate(template);
```

### Template Picker Dialog

```typescript
// Show template picker
const template = await showTemplatePickerDialog(workspaceId);

if (template) {
  // Create session from selected template
  const session = await createSessionFromTemplate(template);
  navigateToSession(session.id);
}
```

### Popular Templates (Sorted by Usage)

```typescript
const templates = await ipcRenderer.invoke('template:list', 'all', workspaceId);
const popular = templates
  .sort((a, b) => b.usageCount - a.usageCount)
  .slice(0, 5);
```

---

## New Features (2026-01-26)

### Gather Context Field

The `gatherContext` field instructs Claude on what information to gather from the user before starting work:

```typescript
{
  "gatherContext": "Ask the user: 1) What feature to build? 2) Requirements? 3) Affected files?"
}
```

When a session starts from this template, Claude asks these questions first, then proceeds once it has context.

**Benefits:**
- Makes templates flexible and reusable
- Ensures Claude has necessary context before starting
- Reduces back-and-forth clarification

**Example:**
```typescript
await ipcRenderer.invoke('template:create', {
  name: 'Feature Build',
  scope: 'workspace',
  workspaceId: 'workspace-123',
  permissionMode: 'allow-all',
  thinkingLevel: 3,
  gatherContext: 'Ask: 1) What feature? 2) Requirements? 3) Which files are involved?'
});
```

### Schedule Creation Tool

The `schedule_create` tool enables conversational schedule creation from within sessions:

**Location:** `packages/shared/src/agent/session-scoped-tools.ts`

**Tool signature:**
```typescript
interface ScheduleCreateData {
  name: string;
  prompt: string;
  scheduleType: 'recurring' | 'once';
  // Recurring options
  frequency?: 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'custom';
  hour?: number;        // 0-23
  minute?: number;      // 0-59
  dayOfWeek?: number;   // 0-6 (Sun=0)
  dayOfMonth?: number;  // 1-31
  customCron?: string;
  // One-time options
  scheduledFor?: string; // ISO timestamp
}
```

**Example usage:**
```
User: "Remind me to review PRs every weekday at 10am"
Claude: [uses schedule_create tool]
✓ Schedule "Review PRs" created!
Schedule: Every weekday at 10:00 AM
Next run: 2026-01-27T10:00:00Z
```

**Validation:**
- Minimum interval: 1 minute
- Past timestamps rejected (1-minute tolerance)
- Maximum 100 schedules per workspace

### Default Starter Templates

When `template:create-defaults` is called, creates 6 ready-to-use templates:

1. **Code Review** - Safe mode, review prompt
2. **Feature Build** - Allow-all, extended thinking, gather context
3. **Bug Investigation** - Safe mode, investigation prompt, gather context
4. **Documentation** - Ask mode, gather context
5. **Refactoring** - Ask mode, extended thinking, gather context
6. **Quick Question** - Safe mode, no extended thinking

Only creates if workspace has no templates.

## Best Practices

1. **Use workspace scope** for project-specific workflows
2. **Use global scope** for reusable patterns across projects
3. **Include gather context** instead of hard-coding assumptions
4. **Track usage** to identify popular templates
5. **Save successful sessions** as templates for repeatability
6. **Associate task lists** for multi-agent coordination
7. **Use schedule_create** for automated recurring workflows
8. **Leverage default templates** as starting points for customization
