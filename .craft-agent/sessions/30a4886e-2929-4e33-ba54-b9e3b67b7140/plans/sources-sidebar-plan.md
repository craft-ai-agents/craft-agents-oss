# Sources Sidebar with Built-in `_source-setup` Agent

## Summary

Add a "Sources" section to the Electron sidebar that displays configured sources and includes an "Add Source" button. Clicking "Add Source" opens a new chat with a built-in `_source-setup` agent that conversationally helps users configure new sources, presents a plan for approval, and executes the configuration.

## Architecture

- **Built-in agent** (`_source-setup`) uses the same filesystem structure as user agents
- **Underscore prefix** convention marks agents as hidden from the Agents sidebar
- **Session-scoped tools** provide source management capabilities to the agent
- **Existing infrastructure** is reused: agent activation, chat, SubmitPlan flow

## Steps

### 1. Add hidden agent filtering to sidebar

**File:** `apps/electron/src/renderer/components/chat/Chat.tsx`

- Filter agents with `_` prefix from the AgentTree display
- Add check: `agents.filter(a => !a.slug.startsWith('_'))`

### 2. Create `_source-setup` agent scaffolding

**Location:** Create utility to ensure built-in agents exist

**File:** `packages/shared/src/agents/builtin-agents.ts` (new)

```typescript
// Define built-in agent specs
const BUILTIN_AGENTS = {
  '_source-setup': {
    name: 'Source Setup',
    instructions: '... (source setup prompt)',
  }
}

// Ensure built-in agents exist for workspace
export function ensureBuiltinAgents(workspaceSlug: string): void
```

**File:** `packages/shared/src/agents/folder-storage.ts`

- Add `isBuiltin` flag to `FolderAgentConfig` type
- Call `ensureBuiltinAgents()` during agent loading

### 3. Write `_source-setup` agent instructions

**Content:** Instructions that tell the agent to:
- Ask about service type (MCP server, REST API, local filesystem)
- Gather required info (URL, auth type, credentials)
- Explain common providers (Linear, GitHub, Notion, etc.)
- Present config as a plan using SubmitPlan
- Execute source creation on approval

### 4. Add source management tools to session-scoped tools

**File:** `packages/shared/src/agent/session-scoped-tools.ts`

Add new tool factories:

```typescript
createSourceListTool(sessionId, workspaceSlug)
  // Returns list of configured sources

createSourceCreateTool(sessionId, workspaceSlug)
  // Creates a new source from config

createSourceUpdateTool(sessionId, workspaceSlug)
  // Updates an existing source config

createSourceDeleteTool(sessionId, workspaceSlug)
  // Deletes a source by slug
```

Register in `getSessionScopedTools()` (line ~1450)

### 5. Add Sources section to sidebar

**File:** `apps/electron/src/renderer/components/chat/Chat.tsx`

Add after Agents section:
- Collapsible "Sources" header
- Source list with status indicators (similar to AgentTree)
- "Add Source" button at top
- Status: authenticated/needs_auth/error

**File:** `apps/electron/src/renderer/lib/local-storage.ts`

- Add `sourcesCollapsed` storage key

### 6. Create SourceTree component

**File:** `apps/electron/src/renderer/components/chat/SourceTree.tsx` (new)

- Similar structure to AgentTree
- Shows sources grouped by type (MCP, API, Local)
- Status indicators for auth state
- Context menu: Edit, Delete, Test, Authenticate

### 7. Implement "Add Source" handler

**File:** `apps/electron/src/renderer/components/chat/Chat.tsx`

```typescript
const handleAddSource = useCallback(async () => {
  // 1. Create new session with _source-setup agent
  const session = await onCreateSession(workspaceId, '_source-setup')

  // 2. Open chat tab
  openChatTab(session.id, workspaceId, 'Add Source', '_source-setup')
}, [workspaceId, onCreateSession, openChatTab])
```

### 8. Add IPC handler for source updates (if needed)

**File:** `apps/electron/src/main/ipc.ts`

- `SOURCES_UPDATE` - Update existing source config
- `SOURCES_ENABLE` - Enable/disable source

### 9. Update preload to expose source IPC

**File:** `apps/electron/src/preload/index.ts`

Ensure source management functions are exposed:
- `getSources(workspaceSlug)`
- `createSource(workspaceSlug, config)`
- `updateSource(workspaceSlug, sourceSlug, config)`
- `deleteSource(workspaceSlug, sourceSlug)`
- `testSource(workspaceSlug, sourceSlug)`

## Files Changed

| File | Change |
|------|--------|
| `packages/shared/src/agents/builtin-agents.ts` | New - built-in agent definitions |
| `packages/shared/src/agents/folder-storage.ts` | Add `isBuiltin` flag, ensure built-ins |
| `packages/shared/src/agents/folder-types.ts` | Add `isBuiltin` to config type |
| `packages/shared/src/agent/session-scoped-tools.ts` | Add source CRUD tools |
| `apps/electron/src/renderer/components/chat/Chat.tsx` | Sources section, agent filtering |
| `apps/electron/src/renderer/components/chat/SourceTree.tsx` | New - source tree component |
| `apps/electron/src/renderer/lib/local-storage.ts` | Add `sourcesCollapsed` key |
| `apps/electron/src/main/ipc.ts` | Add `SOURCES_UPDATE` handler |
| `apps/electron/src/preload/index.ts` | Expose source IPC methods |

## User Flow

1. User clicks "Add Source" in Sources sidebar section
2. New chat opens with `_source-setup` agent pre-activated
3. Agent asks: "What kind of source would you like to add?"
4. User describes: "I want to connect to Linear"
5. Agent asks for URL, auth method, API key
6. Agent presents SubmitPlan with source config
7. User approves plan
8. Agent executes `source_create` tool
9. Source appears in sidebar, user can test/authenticate

## Notes

- Built-in agents ship with the app but live in workspace folders
- `_` prefix convention can extend to other built-in agents later
- Same pattern works for TUI (just different UI trigger)
- Sources section could show auth status badges like agents do
