# Session Templates API

Session Templates provide reusable session configuration presets with optional initial prompts and skill selection.

## Storage

- **Global:** `~/.vesper/templates/global.json`
- **Workspace:** `~/.vesper/workspaces/{id}/templates/workspace.json`
- **Concurrency:** File-based locking with `proper-lockfile`

## Data Types

### SessionTemplate

```typescript
interface SessionTemplate {
  id: string;
  name: string;
  description?: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;         // Required for workspace-scoped templates

  // Session configuration
  permissionMode?: PermissionMode;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  workingDirectory?: string;
  skillIds?: string[];
  taskListId?: string;          // Optional task list association

  // Optional initial prompt
  initialPrompt?: string;

  // Usage tracking
  usageCount: number;

  createdAt: number;
  updatedAt: number;
}
```

### CreateTemplateOptions

```typescript
interface CreateTemplateOptions {
  name: string;
  description?: string;
  scope: 'global' | 'workspace';
  workspaceId?: string;
  permissionMode?: PermissionMode;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  workingDirectory?: string;
  skillIds?: string[];
  taskListId?: string;
  initialPrompt?: string;
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

**Default Templates:**
1. **Quick Chat** - Basic session with ask mode
2. **Safe Mode** - Read-only exploration
3. **Development** - Allow-all with common dev skills

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

## Best Practices

1. **Use workspace scope** for project-specific workflows
2. **Use global scope** for reusable patterns across projects
3. **Include initial prompts** for guided workflows
4. **Track usage** to identify popular templates
5. **Save successful sessions** as templates for repeatability
6. **Associate task lists** for structured feature development
7. **Version control templates** by exporting/importing JSON files
