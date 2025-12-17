# @craft-agent/session-manager

Reactive session orchestration for Craft Agent applications. Provides a type-safe event emitter pattern for UI components to subscribe to agent state changes.

## Installation

```bash
# In a workspace package
bun add @craft-agent/session-manager
```

Or add to `package.json`:
```json
{
  "dependencies": {
    "@craft-agent/session-manager": "workspace:*"
  }
}
```

## Quick Start

```typescript
import { SessionManager } from '@craft-agent/session-manager';
import type { Session } from '@craft-agent/core';
import { DEFAULT_MODEL } from '../../src/config/models'; // Use centralized config

// Create a session manager
const manager = new SessionManager({
  session: mySession,
  model: DEFAULT_MODEL, // Always use centralized model config
});

// Subscribe to events
const unsubscribe = manager.on('message:add', (message) => {
  console.log('New message:', message.content);
});

// Process events from CraftAgent
for await (const event of agent.chat(userMessage)) {
  manager.processEvent(event);
}

// Cleanup
unsubscribe();
manager.dispose();
```

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message:add` | `Message` | New message added |
| `message:update` | `{ id, updates }` | Message updated |
| `message:remove` | `string` (id) | Message removed |
| `stream:text` | `string` | Text delta received |
| `stream:clear` | `void` | Streaming complete |
| `processing:start` | `void` | Agent started processing |
| `processing:end` | `void` | Agent finished processing |
| `token:update` | `TokenUsage` | Token counts updated |
| `permission:request` | `PermissionRequest` | Tool needs approval |
| `permission:resolve` | `string` (requestId) | Permission resolved |
| `question:request` | `QuestionRequest` | Agent asking question |
| `question:resolve` | `string` (requestId) | Question answered |
| `error` | `TypedError` | Typed error occurred |
| `error:message` | `string` | Error message |
| `session:ready` | `void` | Session initialized |
| `session:disposed` | `void` | Session cleaned up |

## API

### SessionManager

```typescript
class SessionManager {
  // Constructor
  constructor(config: SessionManagerConfig);

  // State getters
  getSession(): Session;
  getMessages(): Message[];
  getTokenUsage(): TokenUsage;
  isCurrentlyProcessing(): boolean;
  getStreamingText(): string;

  // Event subscription
  on<K>(event: K, handler: (data: Events[K]) => void): () => void;
  once<K>(event: K, handler: (data: Events[K]) => void): () => void;
  off<K>(event: K, handler: (data: Events[K]) => void): void;

  // Message management
  addMessage(message: Message): void;
  updateMessage(id: string, updates: Partial<Message>): void;
  clearMessages(): void;

  // Process agent events
  processEvent(event: AgentEvent): void;

  // Interactive responses
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;
  respondToQuestion(requestId: string, answers: Record<string, string>): void;

  // Cleanup
  dispose(): void;
}
```

### SessionManagerConfig

```typescript
interface SessionManagerConfig {
  session: Session;
  model?: string;
  onPermissionRequest?: (request: PermissionRequest) => Promise<{
    allowed: boolean;
    alwaysAllow?: boolean;
  }>;
  onQuestionRequest?: (request: QuestionRequest) => Promise<Record<string, string>>;
}
```

### TypedEventEmitter

Base class for type-safe events:

```typescript
class TypedEventEmitter<Events> {
  on<K>(event: K, handler: (data: Events[K]) => void): () => void;
  once<K>(event: K, handler: (data: Events[K]) => void): () => void;
  off<K>(event: K, handler: (data: Events[K]) => void): void;
  removeAllListeners(): void;
  listenerCount<K>(event: K): number;
}
```

## React Integration

```typescript
function useSessionManager(manager: SessionManager) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');

  useEffect(() => {
    const unsubs = [
      manager.on('message:add', (msg) => setMessages(p => [...p, msg])),
      manager.on('stream:text', (delta) => setStreaming(p => p + delta)),
      manager.on('stream:clear', () => setStreaming('')),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [manager]);

  return { messages, streaming };
}
```

## Dependencies

- `@craft-agent/core` - Shared types

## License

MIT
