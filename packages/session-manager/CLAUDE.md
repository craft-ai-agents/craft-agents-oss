# CLAUDE.md - Session Manager Package

This file provides guidance to Claude Code when working with the `@craft-agent/session-manager` package.

**Important:** Keep this file and `README.md` up-to-date whenever functionality changes. After making changes to this package, update the documentation to reflect the current state.

## Overview

The session-manager package provides reactive session orchestration for Craft Agent applications. It wraps CraftAgent interactions and provides a type-safe event emitter pattern for UI components to subscribe to state changes.

**Purpose:** Decouple UI components from direct CraftAgent interaction, enabling both TUI (Ink/React) and Electron apps to use the same session management logic.

## Directory Structure

```
packages/session-manager/
├── src/
│   ├── index.ts              # Main exports
│   ├── session-manager.ts    # SessionManager class
│   └── event-emitter.ts      # TypedEventEmitter base class
├── package.json
└── tsconfig.json
```

## Architecture

### Event-Driven Design

SessionManager uses an event emitter pattern to notify UI of state changes:

```
CraftAgent              SessionManager              UI Component
    │                        │                           │
    │  AgentEvent            │                           │
    │──────────────────────▶│                           │
    │                        │  processEvent()          │
    │                        │──────────────▶           │
    │                        │                           │
    │                        │  emit('message:add')      │
    │                        │──────────────────────────▶│
    │                        │                           │ re-render
```

### Event Types

```typescript
interface SessionManagerEvents {
  // Message lifecycle
  'message:add': Message;
  'message:update': { id: string; updates: Partial<Message> };
  'message:remove': string;

  // Streaming
  'stream:text': string;      // Text delta received
  'stream:clear': void;       // Streaming complete

  // Processing state
  'processing:start': void;
  'processing:end': void;

  // Token tracking
  'token:update': TokenUsage;

  // Interactive requests
  'permission:request': PermissionRequest;
  'permission:resolve': string;
  'question:request': QuestionRequest;
  'question:resolve': string;

  // Errors
  'error': TypedError;
  'error:message': string;

  // Lifecycle
  'session:ready': void;
  'session:disposed': void;
}
```

## Key Components

### TypedEventEmitter

A type-safe event emitter base class:

```typescript
class TypedEventEmitter<Events> {
  on<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void;
  once<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, handler: (data: Events[K]) => void): void;
  protected emit<K extends keyof Events>(event: K, data: Events[K]): void;
  removeAllListeners(): void;
  listenerCount<K extends keyof Events>(event: K): number;
}
```

The `on()` method returns an unsubscribe function for easy cleanup in React effects.

### SessionManager

Main orchestration class:

```typescript
class SessionManager extends TypedEventEmitter<SessionManagerEvents> {
  // State getters
  getSession(): Session;
  getMessages(): Message[];
  getTokenUsage(): TokenUsage;
  isCurrentlyProcessing(): boolean;
  getStreamingText(): string;

  // Message management
  addMessage(message: Message): void;
  updateMessage(id: string, updates: Partial<Message>): void;
  clearMessages(): void;

  // Event processing
  processEvent(event: AgentEvent): void;

  // Interactive responses
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;
  respondToQuestion(requestId: string, answers: Record<string, string>): void;

  // Lifecycle
  dispose(): void;
}
```

## Usage Pattern

### Creating a SessionManager

```typescript
import { SessionManager } from '@craft-agent/session-manager';
import { DEFAULT_MODEL } from '../../src/config/models'; // Use centralized config

const manager = new SessionManager({
  session: currentSession,
  model: DEFAULT_MODEL, // Always use centralized model config
  onPermissionRequest: async (request) => {
    // Show permission dialog
    return { allowed: true, alwaysAllow: false };
  },
  onQuestionRequest: async (request) => {
    // Show question dialog
    return { question1: 'answer1' };
  },
});
```

### Subscribing to Events (React)

```typescript
useEffect(() => {
  const unsubMessage = manager.on('message:add', (message) => {
    setMessages(prev => [...prev, message]);
  });

  const unsubStream = manager.on('stream:text', (delta) => {
    setStreamingText(prev => prev + delta);
  });

  return () => {
    unsubMessage();
    unsubStream();
  };
}, [manager]);
```

### Processing Agent Events

```typescript
// Feed events from CraftAgent into SessionManager
for await (const event of agent.chat(message)) {
  manager.processEvent(event);
}
```

## Event Flow Examples

### Text Streaming

1. `AgentEvent { type: 'text_delta', text: 'Hello' }` received
2. `processEvent()` appends to `streamingText`
3. `emit('stream:text', 'Hello')` notifies UI
4. UI updates streaming display

5. `AgentEvent { type: 'text_complete', text: 'Hello world' }` received
6. `processEvent()` creates Message, clears streaming
7. `emit('message:add', message)` notifies UI
8. `emit('stream:clear')` notifies UI
9. UI adds message to list, clears streaming display

### Tool Execution

1. `AgentEvent { type: 'tool_start', toolName, toolUseId, input }` received
2. `processEvent()` creates tool Message with `status: 'executing'`
3. `emit('message:add', toolMessage)` notifies UI
4. UI shows tool as running

5. `AgentEvent { type: 'tool_result', toolUseId, result }` received
6. `processEvent()` updates tool message with result, duration
7. `emit('message:update', { id, updates })` notifies UI
8. UI shows tool as complete with result

## Design Decisions

### Immutable State Returns

All getters return copies to prevent external mutation:
```typescript
getMessages(): Message[] {
  return [...this.messages];  // Copy, not reference
}
```

### Automatic Handler Invocation

If config provides `onPermissionRequest` or `onQuestionRequest`, they're automatically called when those events occur. This allows simple setup while still emitting events for UI feedback.

### Tool Duration Tracking

Tool execution duration is tracked automatically by recording start time on `tool_start` and calculating delta on `tool_result`.

## Dependencies

- `@craft-agent/core` - Types (Session, Message, AgentEvent, etc.)
