# Testing Guide

This guide covers testing strategies, patterns, and best practices for Vesper.

## Table of Contents

- [Testing Philosophy](#testing-philosophy)
- [Test Infrastructure](#test-infrastructure)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [E2E Testing](#e2e-testing)
- [Test Patterns](#test-patterns)
- [Writing Good Tests](#writing-good-tests)

## Testing Philosophy

Vesper follows a pragmatic testing approach:

1. **Test behavior, not implementation** - Tests should verify what the code does, not how it does it
2. **Write tests that provide value** - Focus on critical paths and complex logic
3. **Keep tests simple and readable** - Tests are documentation
4. **Test at the appropriate level** - Unit tests for logic, integration for workflows, E2E for user flows
5. **Mock sparingly** - Prefer real implementations where possible

## Test Infrastructure

### Test Runner

Vesper uses **Bun Test** for all unit and integration tests.

**Why Bun Test:**
- Fast execution (TypeScript support built-in)
- No transpilation step required
- Compatible API with Jest/Vitest
- Built-in mocking capabilities

**Running Tests:**
```bash
# Run all tests
bun test

# Run specific file
bun test packages/shared/src/agent/vesper-agent.test.ts

# Run with pattern
bun test session

# Watch mode
bun test --watch

# Coverage
bun test --coverage
```

### Test File Organization

Tests live alongside source code in `__tests__/` directories:

```
packages/shared/src/
├── agent/
│   ├── vesper-agent.ts
│   ├── mode-manager.ts
│   └── __tests__/
│       ├── vesper-agent.test.ts
│       ├── vesper-agent-tasklist.test.ts
│       └── source-state.test.ts
├── telegram/
│   ├── debounce.ts
│   ├── retry.ts
│   └── __tests__/
│       ├── debounce.test.ts
│       └── retry.test.ts
└── task-lists/
    ├── storage.ts
    └── __tests__/
        └── storage.test.ts
```

**Benefits:**
- Easy to find tests for a given module
- Clear what code is tested
- Tests move with code during refactoring

## Unit Testing

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

describe('ModuleName', () => {
  // Setup before each test
  beforeEach(() => {
    // Initialize state
  });

  // Cleanup after each test
  afterEach(() => {
    // Reset state, close connections, etc.
  });

  describe('functionName', () => {
    it('should do something when condition is met', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('should handle edge case', () => {
      // Test edge cases, errors, boundary conditions
    });
  });
});
```

### Example: Testing Debouncing Logic

From `packages/shared/src/telegram/__tests__/debounce.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { InboundDebouncer, type DebouncedMessage } from '../debounce';
import type { TelegramMessage } from '../types';

describe('InboundDebouncer', () => {
  let debouncer: InboundDebouncer;
  let flushedMessages: DebouncedMessage[] = [];

  beforeEach(() => {
    flushedMessages = [];
    debouncer = new InboundDebouncer({
      debounceMs: 50, // Short delay for testing
      onFlush: async (msg) => {
        flushedMessages.push(msg);
      }
    });
  });

  afterEach(() => {
    debouncer.cleanup();
  });

  const createMessage = (
    content: string,
    chatId = 123,
    userId = 456,
    messageId = 1
  ): TelegramMessage => ({
    id: messageId,
    chatId,
    chatTitle: 'Test Chat',
    chatType: 'private',
    userId,
    username: 'testuser',
    firstName: 'Test',
    content,
    timestamp: Math.floor(Date.now() / 1000),
    attachments: []
  });

  it('should flush single message after debounce window', async () => {
    await debouncer.add(createMessage('Hello'));

    // Wait for debounce window
    await new Promise(r => setTimeout(r, 100));

    expect(flushedMessages.length).toBe(1);
    expect(flushedMessages[0]!.combinedContent).toBe('Hello');
  });

  it('should combine rapid sequential messages from same user', async () => {
    await debouncer.add(createMessage('Message 1', 123, 456, 1));
    await debouncer.add(createMessage('Message 2', 123, 456, 2));
    await debouncer.add(createMessage('Message 3', 123, 456, 3));

    await new Promise(r => setTimeout(r, 100));

    expect(flushedMessages.length).toBe(1);
    expect(flushedMessages[0]!.messages.length).toBe(3);
    expect(flushedMessages[0]!.combinedContent).toBe(
      'Message 1\n\nMessage 2\n\nMessage 3'
    );
  });

  it('should keep messages from different users separate', async () => {
    await debouncer.add(createMessage('User 1 message', 123, 456, 1));
    await debouncer.add(createMessage('User 2 message', 123, 789, 2));

    await new Promise(r => setTimeout(r, 100));

    expect(flushedMessages.length).toBe(2);
    expect(flushedMessages[0]!.combinedContent).toBe('User 1 message');
    expect(flushedMessages[1]!.combinedContent).toBe('User 2 message');
  });
});
```

**Key Patterns:**
- Helper function `createMessage()` for test data
- Timing control with `setTimeout` and `Promise`
- Cleanup in `afterEach()` to prevent leaks
- Clear test names describing behavior

### Mocking

Bun Test provides `mock()` for function mocking:

```typescript
import { mock } from 'bun:test';

// Mock a function
const mockCallback = mock(() => 'mocked value');

// Use the mock
mockCallback('arg');

// Assertions
expect(mockCallback).toHaveBeenCalledTimes(1);
expect(mockCallback).toHaveBeenCalledWith('arg');
expect(mockCallback).toHaveReturnedWith('mocked value');

// Reset mock
mockCallback.mockClear();
mockCallback.mockReset();
```

**Module Mocking:**

```typescript
import { mock } from 'bun:test';

// Mock entire module
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mock(() => {
    return (async function* () {
      yield { type: 'result', result: { output: 'Mock response' } };
    })();
  }),
}));
```

### Testing Async Code

```typescript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBe('expected');
});

it('should reject with error', async () => {
  await expect(asyncFunction()).rejects.toThrow('Error message');
});

it('should resolve with value', async () => {
  await expect(asyncFunction()).resolves.toBe('value');
});
```

### Testing Error Handling

```typescript
it('should throw error for invalid input', () => {
  expect(() => functionName('')).toThrow('Input is required');
});

it('should throw specific error type', () => {
  expect(() => functionName('')).toThrow(CustomError);
});

it('should handle async errors', async () => {
  await expect(asyncFunction()).rejects.toThrow('Async error');
});
```

## Integration Testing

Integration tests verify that multiple components work together correctly.

### Example: Task Lists IPC Integration

From `apps/electron/src/main/__tests__/task-lists-ipc.test.ts`:

This test demonstrates comprehensive integration testing with mock storage:

```typescript
/**
 * E2E Tests for Task Lists IPC Handlers
 *
 * Tests all IPC handlers, event broadcasting, error handling, and edge cases.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { TaskList, Task, TaskListMeta, TaskStatus } from '@vesper/shared/task-lists';
import { TaskListError } from '@vesper/shared/task-lists';

// ============================================================================
// Mock Storage Layer
// ============================================================================

class MockTaskListStorage {
  private taskLists = new Map<string, TaskList>();
  private shouldThrowError: TaskListError | null = null;

  reset(): void {
    this.taskLists.clear();
    this.shouldThrowError = null;
  }

  injectError(error: TaskListError): void {
    this.shouldThrowError = error;
  }

  async createTaskList(name: string, description?: string): Promise<TaskList> {
    if (this.shouldThrowError) throw this.shouldThrowError;

    const taskList: TaskList = {
      id: `tl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      description,
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.taskLists.set(taskList.id, taskList);
    return taskList;
  }

  // ... more methods
}

// ============================================================================
// IPC Handler Simulator
// ============================================================================

class TaskListIpcSimulator {
  private storage: MockTaskListStorage;
  private broadcastMock: ReturnType<typeof mock>;

  async handleCreate(name: string, description?: string): Promise<TaskList> {
    try {
      const taskList = await this.storage.createTaskList(name, description);
      this.broadcastMock(taskList.id);
      return taskList;
    } catch (error) {
      console.error('[task-lists:create] Error:', error);
      throw error;
    }
  }

  // ... more handlers
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Task Lists IPC Handlers', () => {
  let storage: MockTaskListStorage;
  let broadcastMock: ReturnType<typeof mock>;
  let ipc: TaskListIpcSimulator;

  beforeEach(() => {
    storage = new MockTaskListStorage();
    broadcastMock = mock(() => {});
    ipc = new TaskListIpcSimulator(storage, broadcastMock);
  });

  afterEach(() => {
    storage.reset();
  });

  describe('task-lists:create', () => {
    it('should create a new task list with name only', async () => {
      const result = await ipc.handleCreate('My Task List');

      expect(result.id).toBeDefined();
      expect(result.name).toBe('My Task List');
      expect(result.tasks).toEqual([]);
    });

    it('should broadcast task list changed event', async () => {
      const result = await ipc.handleCreate('My Task List');

      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(result.id);
    });

    it('should reject empty name', async () => {
      await expect(ipc.handleCreate('')).rejects.toThrow('Task list name is required');
    });
  });

  describe('Event Broadcasting', () => {
    it('should broadcast on task list creation', async () => {
      const taskList = await ipc.handleCreate('Test List');
      expect(broadcastMock).toHaveBeenCalledWith(taskList.id);
    });

    it('should not broadcast for list or get operations', async () => {
      const taskList = await storage.createTaskList('Test List');
      broadcastMock.mockClear();

      await ipc.handleList();
      await ipc.handleGet(taskList.id);

      expect(broadcastMock).not.toHaveBeenCalled();
    });
  });
});
```

**Key Patterns:**
- Mock storage layer mimics real behavior
- IPC simulator tests handler logic without Electron
- Comprehensive test coverage (happy path, errors, edge cases)
- Clear test organization with nested `describe()` blocks

### Example: VesperAgent Task List Integration

From `packages/shared/src/agent/__tests__/vesper-agent-tasklist.test.ts`:

```typescript
/**
 * Integration tests for VesperAgent task list ID injection
 *
 * Verifies CLAUDE_CODE_TASK_LIST_ID environment variable injection
 * for multi-agent workflow coordination.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { VesperAgent } from '../vesper-agent.ts';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';

// Mock SDK to capture env vars
let capturedEnv: Record<string, string> | null = null;

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: any) => {
    capturedEnv = { ...getDefaultOptions().env };
    return (async function* () {
      yield {
        type: 'result',
        result: { output: 'Mock response' },
      };
    })();
  },
}));

describe('VesperAgent task list injection', () => {
  let testDirs: string[] = [];

  afterEach(() => {
    for (const dir of testDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    testDirs = [];
  });

  it('should inject CLAUDE_CODE_TASK_LIST_ID when taskListId is set', async () => {
    const agent = new VesperAgent(createTestConfig());
    agent.setTaskListId('test-task-list-456');

    const generator = agent.chat('Hello');
    for await (const event of generator) {
      // Consume events
    }

    expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBe('test-task-list-456');
  });

  it('should not inject env var when taskListId is undefined', async () => {
    const agent = new VesperAgent(createTestConfig());

    const generator = agent.chat('Hello');
    for await (const event of generator) {
      // Consume events
    }

    expect(capturedEnv?.CLAUDE_CODE_TASK_LIST_ID).toBeUndefined();
  });
});
```

**Key Patterns:**
- Module mocking to intercept SDK calls
- Temporary directory creation for filesystem tests
- Cleanup with `afterEach()` to prevent side effects
- Testing environment variable injection

## E2E Testing

E2E tests verify complete user workflows in a real Electron environment.

### E2E Test Structure

```javascript
// scripts/e2e/terminal-resume.e2e.cjs

const { spawn } = require('child_process');
const path = require('path');

async function runE2ETest() {
  console.log('Starting Terminal Resume E2E Test...');

  try {
    // Step 1: Build Electron app
    console.log('Building Electron app...');
    await buildElectronApp();

    // Step 2: Start Electron in test mode
    console.log('Starting Electron...');
    const electronProcess = startElectron();

    // Step 3: Wait for app to be ready
    await waitForAppReady();

    // Step 4: Execute test scenario
    console.log('Executing test scenario...');
    await testTerminalResume();

    // Step 5: Verify results
    console.log('Verifying results...');
    await verifyResults();

    console.log('✓ E2E test passed');
    process.exit(0);
  } catch (error) {
    console.error('✗ E2E test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    if (electronProcess) {
      electronProcess.kill();
    }
  }
}

runE2ETest();
```

### Running E2E Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run specific E2E test
bun run test:e2e:terminal
bun run test:e2e:skills
bun run test:e2e:scheduler
```

## Test Patterns

### 1. Arrange-Act-Assert (AAA)

```typescript
it('should calculate total price', () => {
  // Arrange - Set up test data
  const cart = new ShoppingCart();
  cart.add({ name: 'Item', price: 10.00 });

  // Act - Execute the behavior
  const total = cart.getTotal();

  // Assert - Verify the result
  expect(total).toBe(10.00);
});
```

### 2. Test Helpers

Extract common setup into helper functions:

```typescript
function createTestAgent(overrides = {}) {
  return new VesperAgent({
    workspace: createTestWorkspace(),
    session: createTestSession(),
    claudeApiKey: 'test-key',
    onEvent: async () => {},
    ...overrides
  });
}

function createTestWorkspace(overrides = {}) {
  return {
    id: 'test-workspace',
    name: 'Test Workspace',
    rootPath: '/tmp/test',
    ...overrides
  };
}

// Usage
it('should create agent with custom config', () => {
  const agent = createTestAgent({
    session: createTestSession({ permissionMode: 'safe' })
  });

  expect(agent).toBeDefined();
});
```

### 3. Test Data Builders

```typescript
class TaskListBuilder {
  private taskList: Partial<TaskList> = {};

  withId(id: string) {
    this.taskList.id = id;
    return this;
  }

  withName(name: string) {
    this.taskList.name = name;
    return this;
  }

  withTasks(...tasks: Task[]) {
    this.taskList.tasks = tasks;
    return this;
  }

  build(): TaskList {
    return {
      id: this.taskList.id || 'test-id',
      name: this.taskList.name || 'Test List',
      tasks: this.taskList.tasks || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...this.taskList
    };
  }
}

// Usage
const taskList = new TaskListBuilder()
  .withName('Feature Tasks')
  .withTasks(task1, task2)
  .build();
```

### 4. Parameterized Tests

```typescript
describe('permission mode validation', () => {
  const testCases = [
    { mode: 'safe', shouldAllow: false },
    { mode: 'ask', shouldAllow: false },
    { mode: 'allow-all', shouldAllow: true },
  ];

  for (const { mode, shouldAllow } of testCases) {
    it(`should ${shouldAllow ? 'allow' : 'block'} in ${mode} mode`, () => {
      const result = checkPermission('bash', mode);
      expect(result).toBe(shouldAllow);
    });
  }
});
```

### 5. Snapshot Testing

```typescript
it('should render markdown correctly', () => {
  const markdown = '# Heading\n\nParagraph with **bold**.';
  const html = renderMarkdown(markdown);

  expect(html).toMatchSnapshot();
});
```

## Writing Good Tests

### Test Naming

Good test names describe behavior:

```typescript
// ✗ Bad - Implementation details
it('should call createTask with correct params');

// ✓ Good - Behavior
it('should create task with pending status');

// ✗ Bad - Vague
it('should work');

// ✓ Good - Specific
it('should reject empty task subject');

// ✗ Bad - No context
it('should return true');

// ✓ Good - Clear behavior
it('should return true when all tasks are completed');
```

### Test Independence

Each test should be independent and isolated:

```typescript
// ✗ Bad - Tests depend on each other
let sharedState;

it('should create user', () => {
  sharedState = createUser();
});

it('should update user', () => {
  updateUser(sharedState); // Depends on previous test
});

// ✓ Good - Independent tests
it('should create user', () => {
  const user = createUser();
  expect(user.id).toBeDefined();
});

it('should update user', () => {
  const user = createUser(); // Create fresh state
  updateUser(user);
  expect(user.updated).toBe(true);
});
```

### Test Coverage

Focus on critical paths and edge cases:

```typescript
describe('divide', () => {
  // Happy path
  it('should divide two positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  // Edge case: Division by zero
  it('should throw when dividing by zero', () => {
    expect(() => divide(10, 0)).toThrow('Cannot divide by zero');
  });

  // Edge case: Negative numbers
  it('should handle negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });

  // Edge case: Floating point
  it('should handle floating point division', () => {
    expect(divide(10, 3)).toBeCloseTo(3.33, 2);
  });
});
```

### Avoid Testing Implementation

Test behavior, not implementation details:

```typescript
// ✗ Bad - Testing implementation
it('should call fetchUser internally', () => {
  const spy = jest.spyOn(api, 'fetchUser');
  getUserData(123);
  expect(spy).toHaveBeenCalled();
});

// ✓ Good - Testing behavior
it('should return user data for valid ID', async () => {
  const data = await getUserData(123);
  expect(data.id).toBe(123);
  expect(data.name).toBeDefined();
});
```

### Keep Tests Simple

Tests should be easy to read and understand:

```typescript
// ✗ Bad - Complex setup
it('should process order', async () => {
  const db = new Database();
  await db.connect();
  const user = await db.createUser({ name: 'Test' });
  const product = await db.createProduct({ price: 100 });
  const cart = new Cart(user.id);
  await cart.addItem(product.id);
  const order = await processOrder(cart);
  expect(order.total).toBe(100);
  await db.disconnect();
});

// ✓ Good - Extracted helpers
it('should process order', async () => {
  const user = await createTestUser();
  const cart = await createCartWithProduct(user, { price: 100 });

  const order = await processOrder(cart);

  expect(order.total).toBe(100);
});
```

## Common Pitfalls

### 1. Flaky Tests

Avoid timing-dependent assertions:

```typescript
// ✗ Flaky - Timing assumption
it('should debounce', async () => {
  debounce(callback, 100);
  await new Promise(r => setTimeout(r, 50)); // Might fail under load
  expect(callback).not.toHaveBeenCalled();
});

// ✓ Robust - Wait for condition
it('should debounce', async () => {
  debounce(callback, 100);
  await waitFor(() => callback.mock.calls.length === 0);
});
```

### 2. Shared Mutable State

```typescript
// ✗ Bad - Shared state between tests
const sharedCache = new Map();

it('should cache result', () => {
  sharedCache.set('key', 'value');
  expect(sharedCache.get('key')).toBe('value');
});

it('should have empty cache', () => {
  expect(sharedCache.size).toBe(0); // Fails! Previous test polluted state
});

// ✓ Good - Fresh state per test
describe('cache', () => {
  let cache;

  beforeEach(() => {
    cache = new Map();
  });

  it('should cache result', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('should have empty cache', () => {
    expect(cache.size).toBe(0);
  });
});
```

### 3. Over-Mocking

```typescript
// ✗ Over-mocked - Testing mocks, not real behavior
it('should fetch data', async () => {
  const mockFetch = mock(() => Promise.resolve({ data: 'mock' }));
  const mockDb = { query: mock(() => 'mock') };
  const mockCache = { get: mock(() => null) };

  const result = await fetchData(mockFetch, mockDb, mockCache);

  expect(result).toBe('mock');
});

// ✓ Better - Test real integration with minimal mocking
it('should fetch data', async () => {
  const result = await fetchData();
  expect(result.data).toBeDefined();
});
```

## Test Checklist

Before committing tests:

- [ ] Tests are independent and can run in any order
- [ ] Tests have clear, descriptive names
- [ ] Setup and teardown properly handled
- [ ] No shared mutable state between tests
- [ ] Edge cases and error scenarios covered
- [ ] Tests are fast (unit tests < 100ms)
- [ ] No hard-coded timeouts or flaky timing
- [ ] Cleanup resources (files, connections, timers)
- [ ] Tests document expected behavior

## Related Documentation

- [Architecture Overview](architecture.md)
- [Development Setup](development-setup.md)
- [Contributing Guide](contributing.md)

---

*Last Updated: 2026-01-26*
