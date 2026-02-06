#!/usr/bin/env bun
/**
 * Test script for cloud-worker WebSocket sync.
 *
 * Usage:
 *   bun packages/cloud-worker/test-sync.ts [command]
 *
 * Commands:
 *   list-sessions              List all sessions
 *   get-session <id>           Get a session with messages
 *   create-session             Create a test session (empty)
 *   create-chat                Create a session with a realistic conversation
 *   send-message <id> <text>   Send a user message + assistant reply to a session
 *   create-source              Create a test source
 *   save-statuses              Save test statuses
 *   save-labels                Save test labels
 *   delete-session <id>        Delete a session by ID
 *
 * Environment:
 *   CLOUD_URL   — Worker URL (default: https://craft-agent-cloud.dventures.workers.dev)
 *   CLOUD_SLUG  — Workspace slug (default: test-workspace)
 *   CLOUD_KEY   — API key
 */

const CLOUD_URL = process.env.CLOUD_URL || 'https://craft-agent-cloud.dventures.workers.dev';
const CLOUD_SLUG = process.env.CLOUD_SLUG || 'test-workspace';
const CLOUD_KEY = process.env.CLOUD_KEY || 'SF2nr7lm9wJ5Zy3BfrOw5VUT35CEh8sQd95Z+TlW260=';

const BASE = `${CLOUD_URL}/workspace/${CLOUD_SLUG}`;
const WS_URL = BASE.replace('https://', 'wss://').replace('http://', 'ws://');

const command = process.argv[2] || 'list-sessions';

// ── REST helpers ──

async function restGet(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${CLOUD_KEY}` },
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  return data;
}

// ── WebSocket helpers ──

function wsSend(msg: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, {
      headers: { Authorization: `Bearer ${CLOUD_KEY}` },
    } as any);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout after 10s'));
    }, 10_000);

    ws.onopen = () => {
      console.log('⚡ Connected to WebSocket');
      console.log('→ Sending:', JSON.stringify(msg, null, 2));
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      clearTimeout(timeout);
      const data = JSON.parse(event.data as string);
      console.log('← Received:', JSON.stringify(data, null, 2));
      ws.close();
      resolve(data);
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      console.error('WebSocket error:', err);
      reject(err);
    };

    ws.onclose = () => {
      clearTimeout(timeout);
    };
  });
}

// ── Commands ──

const sessionId = `test-${Date.now()}`;

const commands: Record<string, () => Promise<void>> = {
  'list-sessions': async () => {
    console.log('📋 Listing sessions...');
    await restGet('/sessions');
  },

  'list-sources': async () => {
    console.log('📋 Listing sources...');
    await restGet('/sources');
  },

  'list-all': async () => {
    console.log('📋 Sessions:');
    await restGet('/sessions');
    console.log('\n📋 Sources:');
    await restGet('/sources');
    console.log('\n📋 Statuses:');
    await restGet('/statuses');
    console.log('\n📋 Labels:');
    await restGet('/labels');
    console.log('\n📋 Skills:');
    await restGet('/skills');
  },

  'get-session': async () => {
    const targetId = process.argv[3];
    if (!targetId) {
      console.error('Usage: bun test-sync.ts get-session <session-id>');
      process.exit(1);
    }
    console.log(`📋 Loading session "${targetId}" with messages...`);
    await restGet(`/sessions/${targetId}`);
  },

  'create-session': async () => {
    console.log(`🆕 Creating session "${sessionId}"...`);
    await wsSend({
      type: 'session:create',
      requestId: `req-${Date.now()}`,
      data: {
        id: sessionId,
        name: `Test Session ${new Date().toLocaleTimeString()}`,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'ask',
        workspaceRootPath: '', // Cloud sessions - workspace resolved by ID
        isFlagged: false,
        thinkingLevel: 'think',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
      },
    });
    console.log(`\n✅ Session created! ID: ${sessionId}`);
    console.log('\nVerifying via REST:');
    await restGet('/sessions');
  },

  'create-chat': async () => {
    const chatId = `chat-${Date.now()}`;
    const now = Date.now();
    const chatName = process.argv[3] || 'Cloud sync test conversation';

    console.log(`🆕 Creating session "${chatId}" with messages...`);

    // First, create the session
    await wsSend({
      type: 'session:create',
      requestId: `req-create-${now}`,
      data: {
        id: chatId,
        name: chatName,
        model: 'claude-sonnet-4-20250514',
        permissionMode: 'ask',
        workspaceRootPath: '', // Cloud sessions - workspace resolved by ID
        isFlagged: false,
        thinkingLevel: 'think',
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          contextTokens: 0,
          costUsd: 0,
        },
      },
    });

    // Build a realistic conversation
    const messages = [
      {
        id: `msg-${now}-1`,
        type: 'user',
        content: 'Hey! Can you help me write a Python function that calculates the fibonacci sequence?',
        timestamp: now,
      },
      {
        id: `msg-${now}-2`,
        type: 'assistant',
        content: 'Sure! Here\'s a clean implementation of the Fibonacci sequence using both iterative and recursive approaches:\n\n```python\ndef fibonacci_iterative(n: int) -> list[int]:\n    """Return the first n Fibonacci numbers."""\n    if n <= 0:\n        return []\n    if n == 1:\n        return [0]\n    \n    fib = [0, 1]\n    for i in range(2, n):\n        fib.append(fib[i-1] + fib[i-2])\n    return fib\n\n\ndef fibonacci_recursive(n: int, memo: dict = {}) -> int:\n    """Return the nth Fibonacci number using memoization."""\n    if n in memo:\n        return memo[n]\n    if n <= 1:\n        return n\n    memo[n] = fibonacci_recursive(n-1, memo) + fibonacci_recursive(n-2, memo)\n    return memo[n]\n```\n\nThe iterative version returns a list of the first `n` numbers, while the recursive version returns the `n`th number using memoization for efficiency.',
        timestamp: now + 1000,
        turnId: `turn-${now}-1`,
      },
      {
        id: `msg-${now}-3`,
        type: 'user',
        content: 'Nice! Can you add a generator version too?',
        timestamp: now + 5000,
      },
      {
        id: `msg-${now}-4`,
        type: 'assistant',
        content: 'Here\'s a generator version that yields Fibonacci numbers lazily:\n\n```python\nfrom typing import Generator\n\ndef fibonacci_generator() -> Generator[int, None, None]:\n    """Yield Fibonacci numbers infinitely."""\n    a, b = 0, 1\n    while True:\n        yield a\n        a, b = b, a + b\n\n# Usage:\n# Get first 10 fibonacci numbers\nfrom itertools import islice\nfirst_10 = list(islice(fibonacci_generator(), 10))\nprint(first_10)  # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]\n```\n\nThe generator version is memory-efficient since it only computes one number at a time, making it ideal for streaming or processing large sequences.',
        timestamp: now + 6000,
        turnId: `turn-${now}-2`,
      },
    ];

    // Save the session with messages using session:save
    const header = {
      id: chatId,
      name: chatName,
      model: 'claude-sonnet-4-20250514',
      permissionMode: 'ask',
      workspaceRootPath: '', // Cloud sessions - workspace resolved by ID
      isFlagged: false,
      thinkingLevel: 'think',
      createdAt: now,
      lastUsedAt: now + 6000,
      lastMessageAt: now + 6000,
      messageCount: messages.length,
      preview: messages[0].content.slice(0, 100),
      lastMessageRole: 'assistant',
      lastFinalMessageId: messages[messages.length - 1].id,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    };

    await wsSend({
      type: 'session:save',
      requestId: `req-save-${now}`,
      data: { id: chatId, header, messages },
    });

    console.log(`\n✅ Chat created with ${messages.length} messages!`);
    console.log(`   ID: ${chatId}`);
    console.log('\nVerifying session list:');
    await restGet('/sessions');
  },

  'send-message': async () => {
    const targetId = process.argv[3];
    const userText = process.argv.slice(4).join(' ') || 'Hello from the test script!';

    if (!targetId) {
      console.error('Usage: bun test-sync.ts send-message <session-id> <message text>');
      process.exit(1);
    }

    console.log(`💬 Sending message to session "${targetId}"...`);

    // Load the existing session
    const res = await fetch(`${BASE}/sessions/${targetId}`, {
      headers: { Authorization: `Bearer ${CLOUD_KEY}` },
    });

    if (!res.ok) {
      console.error(`Session "${targetId}" not found (${res.status})`);
      process.exit(1);
    }

    const session = await res.json() as {
      id: string;
      messages: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const existingMessages = session.messages || [];
    const now = Date.now();

    // Add user message + assistant reply
    const userMsg = {
      id: `msg-${now}-user`,
      type: 'user',
      content: userText,
      timestamp: now,
    };

    const assistantMsg = {
      id: `msg-${now}-assistant`,
      type: 'assistant',
      content: `You said: "${userText}"\n\nThis is a simulated response from the test script. The cloud sync is working if you can see this message in the Electron app!`,
      timestamp: now + 500,
      turnId: `turn-${now}`,
    };

    const allMessages = [...existingMessages, userMsg, assistantMsg];

    // Rebuild header with updated metadata
    const { messages: _msgs, ...headerFields } = session;
    const updatedHeader = {
      ...headerFields,
      lastUsedAt: now + 500,
      lastMessageAt: now + 500,
      messageCount: allMessages.length,
      preview: (headerFields.preview as string) || userText.slice(0, 100),
      lastMessageRole: 'assistant',
      lastFinalMessageId: assistantMsg.id,
    };

    await wsSend({
      type: 'session:save',
      requestId: `req-save-${now}`,
      data: { id: targetId, header: updatedHeader, messages: allMessages },
    });

    console.log(`\n✅ Message sent! (${allMessages.length} total messages now)`);
    console.log(`   User: ${userText}`);
    console.log(`   Assistant: [simulated reply]`);
  },

  'create-source': async () => {
    const slug = `test-source-${Date.now()}`;
    console.log(`🆕 Creating source "${slug}"...`);
    await wsSend({
      type: 'source:create',
      requestId: `req-${Date.now()}`,
      data: {
        slug,
        name: 'Test Source',
        type: 'api',
        description: 'A test source created via the sync test script',
        url: 'https://api.example.com',
      },
    });
    console.log(`\n✅ Source created! Slug: ${slug}`);
    console.log('\nVerifying via REST:');
    await restGet('/sources');
  },

  'save-statuses': async () => {
    console.log('💾 Saving statuses...');
    await wsSend({
      type: 'statuses:save',
      requestId: `req-${Date.now()}`,
      data: {
        version: 1,
        defaultStatusId: 'todo',
        statuses: [
          { id: 'todo', label: 'To Do', color: '#6b7280' },
          { id: 'in-progress', label: 'In Progress', color: '#3b82f6' },
          { id: 'done', label: 'Done', color: '#22c55e' },
        ],
      },
    });
    console.log('\n✅ Statuses saved!');
    console.log('\nVerifying via REST:');
    await restGet('/statuses');
  },

  'save-labels': async () => {
    console.log('🏷️  Saving labels...');
    await wsSend({
      type: 'labels:save',
      requestId: `req-${Date.now()}`,
      data: {
        version: 1,
        labels: [
          { id: 'bug', name: 'Bug', color: '#ef4444' },
          { id: 'feature', name: 'Feature', color: '#8b5cf6' },
          { id: 'docs', name: 'Documentation', color: '#06b6d4' },
        ],
      },
    });
    console.log('\n✅ Labels saved!');
    console.log('\nVerifying via REST:');
    await restGet('/labels');
  },

  'delete-session': async () => {
    const targetId = process.argv[3];
    if (!targetId) {
      console.error('Usage: bun test-sync.ts delete-session <session-id>');
      process.exit(1);
    }
    console.log(`🗑️  Deleting session "${targetId}"...`);
    await wsSend({
      type: 'session:delete',
      requestId: `req-${Date.now()}`,
      data: { sessionId: targetId },
    });
    console.log('\n✅ Session deleted!');
    console.log('\nVerifying via REST:');
    await restGet('/sessions');
  },
};

// ── Run ──

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error(`Available: ${Object.keys(commands).join(', ')}`);
  process.exit(1);
}

handler().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
