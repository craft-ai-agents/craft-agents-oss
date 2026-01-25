# Session Templates

**Type:** Feature Enhancement
**Status:** Planning
**Priority:** High
**Estimated Effort:** 8-12 hours
**Date:** 2026-01-25

## Overview

Add Session Templates to Vesper, allowing users to create reusable session configurations for common workflows. Templates capture the session setup (skills, mode, model, initial prompt) but NOT message history.

## Problem Statement / Motivation

### Why Session Templates?

1. **Workflow Efficiency**: Users repeatedly create similar sessions (code review, writing, research) with the same configuration
2. **Onboarding**: New users can start with pre-configured templates for common tasks
3. **Team Sharing**: Teams can share templates for consistent workflows (via export/import)
4. **Reduced Friction**: One-click session creation instead of manual configuration each time

### User Story

> "As a Vesper power user, I want to save my 'Code Review' session configuration as a template so I can quickly create new code review sessions with my preferred skills, safe mode, and review prompt pre-loaded."

## Proposed Solution

### Template Data Model

```typescript
// packages/shared/src/templates/types.ts

export interface SessionTemplate {
  id: string;                    // UUID
  name: string;                  // User-visible name
  description?: string;          // Optional description
  scope: 'workspace' | 'global'; // Where it's stored
  workspaceId?: string;          // Only for workspace-scoped

  // Session Configuration
  initialPrompt?: string;        // Pre-filled in input box
  skillIds?: string[];           // Skills to attach
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;                // e.g., 'claude-sonnet-4-20250514'
  thinkingLevel?: number;        // 0-5
  workingDirectory?: string;     // Default working directory

  // Metadata
  createdAt: string;             // ISO timestamp
  updatedAt: string;
  usageCount?: number;           // Track popularity
}

export interface CreateTemplateOptions {
  name: string;
  description?: string;
  scope: 'workspace' | 'global';
  workspaceId?: string;
  initialPrompt?: string;
  skillIds?: string[];
  permissionMode?: 'safe' | 'ask' | 'allow-all';
  model?: string;
  thinkingLevel?: number;
  workingDirectory?: string;
}

export interface SaveSessionAsTemplateOptions {
  sessionId: string;
  name: string;
  description?: string;
  scope: 'workspace' | 'global';
  includeInitialPrompt?: boolean; // Whether to capture first user message
}
```

### Storage Structure

```
~/.vesper/
├── templates/                          # Global templates
│   ├── {template-id}.json
│   └── ...
└── workspaces/
    └── {workspace-id}/
        └── templates/                  # Workspace templates
            ├── {template-id}.json
            └── ...
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process                          │
│  ┌────────────────────┐  ┌──────────────────────────────┐   │
│  │ TemplatePickerDialog│  │ TemplateManager             │   │
│  │ (new session flow)  │  │ (CRUD operations)           │   │
│  └─────────┬───────────┘  └──────────────────────────────┘  │
│            │ IPC                                             │
└────────────┼─────────────────────────────────────────────────┘
             │
┌────────────┼─────────────────────────────────────────────────┐
│            ▼         Main Process                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Template IPC Handlers (template:*)                     │  │
│  │  - template:list (scope, workspaceId?)                 │  │
│  │  - template:create (options)                           │  │
│  │  - template:update (id, updates)                       │  │
│  │  - template:delete (id)                                │  │
│  │  - template:get (id)                                   │  │
│  │  - template:save-from-session (options)                │  │
│  └──────────────────┬─────────────────────────────────────┘  │
│                     │                                         │
│  ┌──────────────────▼─────────────────────────────────────┐  │
│  │ TemplateStorage (packages/shared/src/templates/)       │  │
│  │  - listTemplates(scope, workspaceId?)                  │  │
│  │  - createTemplate(options)                             │  │
│  │  - updateTemplate(id, updates)                         │  │
│  │  - deleteTemplate(id)                                  │  │
│  │  - getTemplate(id)                                     │  │
│  │  - extractTemplateFromSession(session)                 │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Storage Layer (2-3 hours)

**Files to create:**
- `packages/shared/src/templates/types.ts` - Type definitions
- `packages/shared/src/templates/storage.ts` - CRUD operations
- `packages/shared/src/templates/index.ts` - Exports

**Storage Implementation:**
```typescript
// packages/shared/src/templates/storage.ts

import { readdir, readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SessionTemplate, CreateTemplateOptions } from './types';

const VESPER_DIR = join(homedir(), '.vesper');

export function getTemplatesDir(scope: 'global' | 'workspace', workspaceId?: string): string {
  if (scope === 'global') {
    return join(VESPER_DIR, 'templates');
  }
  if (!workspaceId) throw new Error('workspaceId required for workspace scope');
  return join(VESPER_DIR, 'workspaces', workspaceId, 'templates');
}

export async function listTemplates(
  scope: 'global' | 'workspace' | 'all',
  workspaceId?: string
): Promise<SessionTemplate[]> {
  const templates: SessionTemplate[] = [];

  if (scope === 'global' || scope === 'all') {
    const globalDir = getTemplatesDir('global');
    templates.push(...await loadTemplatesFromDir(globalDir, 'global'));
  }

  if ((scope === 'workspace' || scope === 'all') && workspaceId) {
    const workspaceDir = getTemplatesDir('workspace', workspaceId);
    templates.push(...await loadTemplatesFromDir(workspaceDir, 'workspace'));
  }

  return templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
}

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
  await writeFile(join(dir, `${template.id}.json`), JSON.stringify(template, null, 2));

  return template;
}

export async function deleteTemplate(id: string, scope: 'global' | 'workspace', workspaceId?: string): Promise<void> {
  const dir = getTemplatesDir(scope, workspaceId);
  await unlink(join(dir, `${id}.json`));
}

export async function incrementUsageCount(id: string, scope: 'global' | 'workspace', workspaceId?: string): Promise<void> {
  const template = await getTemplate(id, scope, workspaceId);
  if (template) {
    template.usageCount = (template.usageCount || 0) + 1;
    template.updatedAt = new Date().toISOString();
    const dir = getTemplatesDir(scope, workspaceId);
    await writeFile(join(dir, `${id}.json`), JSON.stringify(template, null, 2));
  }
}
```

### Phase 2: IPC Handlers (1-2 hours)

**Files to create:**
- `apps/electron/src/main/templates.ts` - IPC handlers

```typescript
// apps/electron/src/main/templates.ts

import { ipcMain } from 'electron';
import * as templateStorage from '@vesper/shared/templates';
import type { CreateTemplateOptions, SaveSessionAsTemplateOptions } from '@vesper/shared/templates';

export function registerTemplateIpcHandlers(sessionManager: SessionManager) {
  ipcMain.handle('template:list', async (_, scope: string, workspaceId?: string) => {
    return templateStorage.listTemplates(scope as any, workspaceId);
  });

  ipcMain.handle('template:create', async (_, options: CreateTemplateOptions) => {
    return templateStorage.createTemplate(options);
  });

  ipcMain.handle('template:delete', async (_, id: string, scope: string, workspaceId?: string) => {
    return templateStorage.deleteTemplate(id, scope as any, workspaceId);
  });

  ipcMain.handle('template:get', async (_, id: string, scope: string, workspaceId?: string) => {
    return templateStorage.getTemplate(id, scope as any, workspaceId);
  });

  ipcMain.handle('template:save-from-session', async (_, options: SaveSessionAsTemplateOptions) => {
    const session = await sessionManager.getSession(options.sessionId);
    if (!session) throw new Error('Session not found');

    return templateStorage.createTemplate({
      name: options.name,
      description: options.description,
      scope: options.scope,
      workspaceId: session.workspaceId,
      initialPrompt: options.includeInitialPrompt ? extractFirstUserMessage(session) : undefined,
      skillIds: session.skills?.map(s => s.id),
      permissionMode: session.permissionMode,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      workingDirectory: session.workingDirectory,
    });
  });

  ipcMain.handle('template:use', async (_, templateId: string, scope: string, workspaceId: string) => {
    // Increment usage count
    await templateStorage.incrementUsageCount(templateId, scope as any, workspaceId);
    return templateStorage.getTemplate(templateId, scope as any, workspaceId);
  });
}
```

### Phase 3: UI Components (3-4 hours)

**Files to create:**
- `apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx`
- `apps/electron/src/renderer/components/templates/TemplateCard.tsx`
- `apps/electron/src/renderer/components/templates/TemplateManager.tsx`
- `apps/electron/src/renderer/components/templates/CreateTemplateDialog.tsx`
- `apps/electron/src/renderer/components/templates/index.ts`
- `apps/electron/src/renderer/atoms/templates.ts`

**TemplatePickerDialog.tsx** (shown when creating new session):
```tsx
// apps/electron/src/renderer/components/templates/TemplatePickerDialog.tsx

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TemplateCard } from './TemplateCard';
import { useTemplates } from '@/hooks/useTemplates';

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  onSelect: (template: SessionTemplate) => void;
  onSkip: () => void;
}

export function TemplatePickerDialog({
  open,
  onOpenChange,
  workspaceId,
  onSelect,
  onSkip
}: TemplatePickerDialogProps) {
  const { templates, isLoading } = useTemplates(workspaceId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start from Template</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-4">
          {/* Blank Session Card */}
          <TemplateCard
            template={null}
            onClick={onSkip}
            isBlank
          />

          {/* Template Cards */}
          {templates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={() => onSelect(template)}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**useTemplates hook:**
```tsx
// apps/electron/src/renderer/hooks/useTemplates.ts

import { useAtom } from 'jotai';
import { templatesAtom, loadTemplatesAtom } from '@/atoms/templates';
import { useEffect } from 'react';

export function useTemplates(workspaceId: string) {
  const [templates] = useAtom(templatesAtom);
  const [, loadTemplates] = useAtom(loadTemplatesAtom);

  useEffect(() => {
    loadTemplates({ scope: 'all', workspaceId });
  }, [workspaceId, loadTemplates]);

  return {
    templates: templates.items,
    isLoading: templates.isLoading,
    error: templates.error,
  };
}
```

### Phase 4: Integration (1-2 hours)

**Modify existing files:**

1. **New Session Flow** - Show template picker before creating session:
   - `apps/electron/src/renderer/pages/ChatPage.tsx` or wherever "New Chat" is handled
   - Present TemplatePickerDialog, then create session with template config

2. **Session Context Menu** - Add "Save as Template" option:
   - `apps/electron/src/renderer/components/session-list/SessionContextMenu.tsx`
   - Opens CreateTemplateDialog

3. **Settings Navigation** - Add Templates section:
   - Link to TemplateManager from Settings page

### Phase 5: Testing (1-2 hours)

**Test files:**
- `packages/shared/src/templates/__tests__/storage.test.ts`
- `apps/electron/src/renderer/components/templates/__tests__/TemplatePickerDialog.test.tsx`

**Test scenarios:**
1. Create global template
2. Create workspace template
3. List templates (combined global + workspace)
4. Delete template
5. Save session as template
6. Create session from template (verify config applied)
7. Usage count increment

## UI/UX Mockups

### Template Picker (New Session Flow)
```
┌─────────────────────────────────────────────────────────────┐
│  Start from Template                                    [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ + Blank Session     │  │ 📝 Code Review      │          │
│  │                     │  │ Safe mode, review   │          │
│  │ Start with empty    │  │ skill attached      │          │
│  │ configuration       │  │ Used 12 times       │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 🔬 Research         │  │ ✍️ Writing          │          │
│  │ Ask mode, web       │  │ Allow-all, writing  │          │
│  │ search enabled      │  │ skill               │          │
│  │ Used 8 times        │  │ Used 5 times        │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Template Manager
```
┌─────────────────────────────────────────────────────────────┐
│  Templates                                [+ New Template]  │
├─────────────────────────────────────────────────────────────┤
│  Global Templates                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 📝 Code Review                              [Edit] [🗑]│   │
│  │ Safe mode, review skill attached                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Workspace Templates                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🔬 Project Research                         [Edit] [🗑]│   │
│  │ Ask mode, research skill, /Users/project            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Success Criteria

- [ ] Templates stored in JSON files (global and workspace-scoped)
- [ ] Create, read, update, delete operations work
- [ ] Template picker shown when creating new session
- [ ] "Save as Template" option in session context menu
- [ ] Template management UI accessible from settings
- [ ] Usage count tracked and templates sorted by popularity
- [ ] Initial prompt pre-filled (not auto-sent) when using template
- [ ] Tests pass for all storage operations

## Future Enhancements (v2)

1. **Template Sharing** - Export/import templates as JSON
2. **Template Marketplace** - Browse community templates on skills.sh
3. **Template Variables** - Placeholders like `{{project_name}}` filled on use
4. **Template Categories** - Organize templates by type (coding, writing, research)
5. **Template Preview** - See what a session would look like before creating

## Dependencies

- No new npm packages required
- Reuses existing shadcn/ui components (Dialog, Card, Button)
- Integrates with existing session creation flow

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Storage conflicts | Medium | Use UUIDs, scope separation |
| Template bloat | Low | Add archive/cleanup later |
| Complex skill references | Medium | Store skill IDs, validate on use |
| Migration if format changes | Medium | Version templates, migrate on load |

---

**Maintained by:** Vesper Architecture Team
**Questions?** Review source files or contact maintainers
