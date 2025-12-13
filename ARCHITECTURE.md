# Craft Terminal Agent - Architecture Overview

The **craft-terminal-agent** is a Claude Code-like terminal interface (TUI) for managing Craft documents. It uses the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`).

## Key Technologies

- **Runtime**: Bun
- **TUI Framework**: Ink 4.x (React for CLIs)
- **AI SDK**: `@anthropic-ai/claude-agent-sdk`
- **MCP Integration**: `@modelcontextprotocol/sdk`
- **Credential Storage**: keytar (OS keychain)

---

## How Agent Setup Works

### 1. Entry Point ([src/index.tsx](src/index.tsx))

```
CLI (meow) → Root Component → Setup Wizard OR Main App
```

The CLI parses arguments (`--setup`, `--url`, `--token`, `--model`), loads stored config from [~/.craft-agent/config.json](~/.craft-agent/config.json), retrieves credentials from OS keychain, then renders either the Setup wizard or main App.

### 2. CraftAgent Class ([src/agent/craft-agent.ts](src/agent/craft-agent.ts))

This is the core wrapper around the Claude Agent SDK:

```typescript
export class CraftAgent {
  constructor(config: CraftAgentConfig) {
    // No SDK initialization here - it's stateless
    this.webSearchEnabled = config.enableWebSearch ?? true;
    this.webFetchEnabled = config.enableWebFetch ?? true;
    this.codeExecutionEnabled = config.enableCodeExecution ?? true;
  }
}
```

**Key insight**: Unlike Mastra, there's no `new Mastra()` or workflow initialization. The SDK is used via the `query()` function directly.

### 3. Agent Execution Flow ([src/agent/craft-agent.ts:415-697](src/agent/craft-agent.ts#L415-L697) `chat()` method)

```typescript
async *chat(userMessage: string, attachments?: FileAttachment[]): AsyncGenerator<AgentEvent> {
  // 1. Build MCP servers config
  const mcpServers: Options['mcpServers'] = {
    craft: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } },
    preferences: getPreferencesServer(),  // In-process MCP server
    ...this.getAgentMcpServers(),          // Sub-agent MCP servers
    ...this.getAgentApiServers(),          // Dynamic REST API servers
  };

  // 2. Configure SDK options
  const options: Options = {
    model: 'claude-sonnet-4-5-20250929',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: getSystemPrompt() },
    tools: { type: 'preset', preset: 'claude_code' },
    mcpServers,
    hooks: { PreToolUse: [/* permission checks */] },
    canUseTool: async (toolName, input) => { /* AskUserQuestion handling */ },
  };

  // 3. Execute query and stream events
  this.currentQuery = query({ prompt, options });
  for await (const message of this.currentQuery) {
    yield this.convertSDKMessage(message);
  }
}
```

### 4. MCP Integration

**External MCP (Craft server)**:
```typescript
craft: {
  type: 'http',
  url: mcpUrl,
  headers: { Authorization: `Bearer ${token}` }
}
```

**In-Process MCP (preferences)**:
```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';

const preferencesServer = createSdkMcpServer({
  name: 'preferences',
  version: '1.0.0',
  tools: [
    tool('update_user_preferences', 'Update preferences...', schema, handler),
    tool('reload_agent_instructions', 'Reload instructions...', {}, handler),
  ],
});
```

### 5. Sub-Agent System ([src/agents/manager.ts](src/agents/manager.ts))

The most sophisticated part - agents are defined in Craft documents:

```
Discovery → Extract Definition → Build MCP Configs → Activate
```

1. **Discovery**: Lists documents in "Agents" folder via MCP
2. **Extraction**: Uses Claude itself to read the document and extract structured config (instructions, MCP servers, APIs)
3. **Activation**: Builds SDK-compatible MCP server configs, handles OAuth if needed
4. **Runtime**: Injects agent instructions into system prompt, adds agent's MCP servers

### 6. State Management ([src/tui/hooks/useAgent.ts](src/tui/hooks/useAgent.ts))

The `useAgent` hook manages all state:

```typescript
export function useAgent(config: CraftAgentConfig): UseAgentResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const agentRef = useRef<CraftAgent | null>(null);
  const agentManagerRef = useRef<SubAgentManager | null>(null);

  const sendMessage = useCallback(async (input: string) => {
    for await (const event of agent.chat(input)) {
      // Process events, update UI state
    }
  }, []);

  return { messages, isProcessing, sendMessage, activateAgent, ... };
}
```

---

## Key Differences from Mastra

| Aspect | Mastra (chaplet) | Claude Agent SDK (craft-terminal-agent) |
|--------|------------------|----------------------------------------|
| **Initialization** | `new Mastra({ workflows })` | Direct `query()` function call |
| **Workflows** | `createWorkflow()` + steps | None - direct execution |
| **Tools** | `createTool()` | `tool()` from SDK |
| **MCP** | `@mastra/mcp` client | Native `mcpServers` config |
| **Streaming** | `workflow.createRunAsync()` | `for await (const msg of query())` |
| **Session** | Manual tracking | SDK `session_id` + `resume` option |

---

## Files Reference

| Component | File | Key Lines |
|-----------|------|-----------|
| CLI Entry | [src/index.tsx](src/index.tsx) | [19-68](src/index.tsx#L19-L68), [179-221](src/index.tsx#L179-L221) |
| CraftAgent | [src/agent/craft-agent.ts](src/agent/craft-agent.ts) | [218-248](src/agent/craft-agent.ts#L218-L248), [415-697](src/agent/craft-agent.ts#L415-L697) |
| MCP Config | [src/agent/craft-agent.ts](src/agent/craft-agent.ts) | [426-459](src/agent/craft-agent.ts#L426-L459) |
| SDK Options | [src/agent/craft-agent.ts](src/agent/craft-agent.ts) | [469-627](src/agent/craft-agent.ts#L469-L627) |
| useAgent Hook | [src/tui/hooks/useAgent.ts](src/tui/hooks/useAgent.ts) | [147-1301](src/tui/hooks/useAgent.ts#L147-L1301) |
| SubAgentManager | [src/agents/manager.ts](src/agents/manager.ts) | [68-723](src/agents/manager.ts#L68-L723) |
| Agent Extractor | [src/agents/extractor.ts](src/agents/extractor.ts) | [51-361](src/agents/extractor.ts#L51-L361) |
| API Tools | [src/agents/api-tools.ts](src/agents/api-tools.ts) | [101-192](src/agents/api-tools.ts#L101-L192) |

---

## High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Entry Layer                               │
│                index.tsx (CLI Entry)                             │
│            [src/index.tsx](src/index.tsx)                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│      Setup.tsx          │     │           App.tsx               │
│   (First-run Wizard)    │     │      (Main Application)         │
│ [src/tui/Setup.tsx]     │     │    [src/tui/App.tsx]            │
│ (src/tui/Setup.tsx)     │     │    (src/tui/App.tsx)            │
└─────────────────────────┘     └─────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    State Management                              │
│                  useAgent.ts (React Hook)                        │
│         [src/tui/hooks/useAgent.ts](src/tui/hooks/useAgent.ts)  │
└─────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│      CraftAgent         │     │       SubAgentManager           │
│    craft-agent.ts       │     │         manager.ts              │
│ [src/agent/             │     │    [src/agents/                 │
│  craft-agent.ts]        │     │     manager.ts]                 │
│ (src/agent/             │     │    (src/agents/                 │
│  craft-agent.ts)        │     │     manager.ts)                 │
└─────────────────────────┘     └─────────────────────────────────┘
                │                               │
                ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│   Claude Agent SDK      │     │         Extractor               │
│      query()            │     │       extractor.ts              │
│                         │     │    [src/agents/                 │
│                         │     │     extractor.ts]               │
│                         │     │    (src/agents/extractor.ts)    │
└─────────────────────────┘     └─────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MCP Integration                             │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ Craft MCP   │  │ Preferences MCP │  │ Dynamic API Servers │  │
│  │  (HTTP)     │  │  (In-Process)   │  │   api-tools.ts      │  │
│  │             │  │                 │  │ [src/agents/        │  │
│  │             │  │                 │  │  api-tools.ts]      │  │
│  │             │  │                 │  │ (src/agents/        │  │
│  │             │  │                 │  │  api-tools.ts)      │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Configuration                                │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ storage.ts  │  │CredentialManager│  │   preferences.ts    │  │
│  │(Config File)│  │  (OS Keychain)  │  │                     │  │
│  │[src/config/ │  │ [src/config/    │  │  [src/config/       │  │
│  │ storage.ts] │  │  credentials.ts]│  │   preferences.ts]   │  │
│  │(src/config/ │  │ (src/config/    │  │  (src/config/       │  │
│  │ storage.ts) │  │  credentials.ts)│  │   preferences.ts)   │  │
│  └─────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

This codebase serves as a working example of what a Claude Agent SDK implementation looks like, directly applicable as a reference for migrating from Mastra-based architectures.
