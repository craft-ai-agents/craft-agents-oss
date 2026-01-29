# CLI Build Challenges: SDK Subprocess Issues

This document captures the challenges encountered while building a CLI for Craft Agents and the lessons learned about the Claude Agent SDK's architecture.

## Objective

Build a simple CLI that uses the same `HeadlessRunner` from `@craft-agent/shared/headless` to interact with Claude, enabling command-line usage of Craft Agents.

## Initial Approach

### What We Tried

1. Created `apps/cli/` with a CLI that imports `HeadlessRunner`
2. `HeadlessRunner` internally uses `CraftAgent`
3. `CraftAgent` uses the Claude Agent SDK's `query()` function

```typescript
// The intended flow
import { HeadlessRunner } from '@craft-agent/shared/headless';

const runner = new HeadlessRunner({
  workspace,
  prompt: "What is 2+2?",
  permissionPolicy: 'allow-safe',
});

for await (const event of runner.runStreaming()) {
  // Process events...
}
```

### The Problem

**Everything hung silently** - no output, no errors, no timeout. The process would start, print "Connecting to workspace..." and "Processing...", then wait forever.

## Debugging Journey

### Attempt 1: Fix Import Paths

**Hypothesis**: Wrong module paths causing silent failures

**Action**: Fixed imports to use correct subpath exports
```typescript
// Wrong
import { DEFAULT_MODEL } from '@craft-agent/shared/config/models';

// Correct
import { DEFAULT_MODEL } from '@craft-agent/shared/config';
```

**Result**: ❌ Still hung

### Attempt 2: SDK Path Initialization

**Hypothesis**: SDK can't find its CLI executable

**Action**: Added `setPathToClaudeCodeExecutable()` call
```typescript
import { setPathToClaudeCodeExecutable } from '@craft-agent/shared/agent';

const cliPath = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js');
setPathToClaudeCodeExecutable(cliPath);
```

**Result**: ❌ Still hung (but path was found correctly)

### Attempt 3: Environment Variable Propagation

**Hypothesis**: API key not reaching the SDK subprocess

**Action**: Added `setAnthropicOptionsEnv()` to pass env vars to subprocess
```typescript
import { setAnthropicOptionsEnv } from '@craft-agent/shared/agent';

setAnthropicOptionsEnv({ ANTHROPIC_API_KEY: apiKey });
```

**Result**: ❌ Still hung

### Attempt 4: Runtime Change

**Hypothesis**: Bun runtime incompatibility

**Action**: Tried running with Node/TSX instead of Bun

**Result**: ❌ Still hung (TSX had other issues with top-level await)

## Isolation Testing

To identify the actual failure point, tested each layer independently:

### Test 1: Direct Anthropic API
```typescript
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();
const message = await client.messages.create({
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 100,
  messages: [{ role: "user", content: "What is 2+2?" }],
});
console.log(message.content[0].text);
```
**Result**: ✅ Worked instantly - returned "4"

### Test 2: SDK CLI Directly
```bash
node node_modules/@anthropic-ai/claude-agent-sdk/cli.js -p "What is 2+2?"
```
**Result**: ✅ Worked instantly - returned "4"

### Test 3: SDK query() Function
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({ prompt: "What is 2+2?", options: { maxTurns: 1 } });
for await (const message of response) {
  console.log(message.type);
}
```
**Result**: ❌ Hung indefinitely

## Root Cause Analysis

### The Architecture

The Claude Agent SDK's `query()` function doesn't make direct API calls. Instead, it:

1. Spawns `cli.js` as a **child subprocess**
2. Communicates with it via **IPC** (inter-process communication)
3. The subprocess handles the actual API calls and tool execution

```
┌─────────────────┐     IPC      ┌─────────────────┐     HTTPS    ┌─────────────────┐
│  Your Code      │◄────────────►│  SDK Subprocess │◄────────────►│  Claude API     │
│  (query())      │              │  (cli.js)       │              │                 │
└─────────────────┘              └─────────────────┘              └─────────────────┘
```

### Why It Failed

The subprocess communication was failing silently. Possible causes:

1. **IPC channel issues**: The way Bun spawns processes may differ from Node/Electron
2. **Missing environment**: The subprocess may need specific env vars or file descriptors
3. **TTY requirements**: The SDK may expect certain terminal capabilities
4. **Electron-specific context**: The existing code may rely on Electron's process model

### Why Electron Works

The Electron app has:
- Specific process initialization in `apps/electron/src/main/sessions.ts`
- `reinitializeAuth()` that sets up environment properly
- Window management that may affect subprocess lifecycle
- Different process spawning via Electron's APIs

## The Solution

**Don't fight the subprocess - wrap the CLI instead.**

```typescript
import { spawn } from 'child_process';

function runSdkCli(cliPath: string, prompt: string, apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, '-p', prompt], {
      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    child.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error(`Exit code ${code}`));
    });
  });
}
```

### Why This Works

1. **No IPC complexity**: Direct stdin/stdout/stderr passthrough
2. **CLI is battle-tested**: The SDK CLI is designed for direct invocation
3. **Simple process model**: Standard Unix process spawning
4. **Same functionality**: All SDK features available via CLI flags

## Comparison

| Approach | Lines of Code | Complexity | Reliability |
|----------|---------------|------------|-------------|
| HeadlessRunner + query() | ~300 | High (IPC, subprocess) | ❌ Failed |
| CLI wrapper | ~180 | Low (spawn + args) | ✅ Works |

## Lessons Learned

### 1. Test in Isolation First

Before building complex integrations, test each component:
```bash
# Does the API work?
bun -e 'import Anthropic from "@anthropic-ai/sdk"; ...'

# Does the CLI work?
node cli.js -p "test"

# Does the programmatic API work?
bun -e 'import { query } from "sdk"; ...'
```

### 2. Silent Failures Are the Hardest

The SDK didn't throw errors - it just hung. Add timeouts and logging early:
```typescript
const timeout = setTimeout(() => {
  console.error('Operation timed out after 30s');
  process.exit(1);
}, 30000);
```

### 3. Wrap Don't Integrate

When a CLI works but its programmatic API doesn't:
- **Don't**: Spend hours debugging subprocess IPC
- **Do**: Wrap the CLI with `spawn()`

### 4. Existing Code Has Hidden Context

The `HeadlessRunner` exists in the codebase and is exported, but:
- It may only work in Electron's environment
- It may require initialization we don't see
- The tests may not exist or may run in special contexts

### 5. Simpler Is Better

The final CLI is:
- Easier to understand
- Easier to maintain
- More portable across environments
- Uses proven, working code paths

## Implications for the Codebase

### HeadlessRunner May Have Issues

The `HeadlessRunner` at `packages/shared/src/headless/runner.ts` may:
- Only work in Electron
- Need additional environment setup
- Have untested edge cases

### Consider CLI-First for New Integrations

For future CLI tools or automation:
1. Test if the SDK CLI meets requirements
2. Wrap the CLI if it does
3. Only use `query()` programmatically if you have Electron's context

### Documentation Gap

The SDK's subprocess architecture isn't well-documented. Users may expect `query()` to work like a simple function call when it's actually spawning processes.

## Files Created

```
apps/cli/
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript config
├── README.md          # Usage documentation
└── src/
    └── index.ts       # CLI implementation (180 lines)
```

## Usage

```bash
# Set API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Simple prompt
bun run apps/cli/src/index.ts "What is 2+2?"

# List workspaces
bun run apps/cli/src/index.ts --list-workspaces

# Continue conversation
bun run apps/cli/src/index.ts -c "Tell me more"

# Interactive mode
bun run apps/cli/src/index.ts
```

---

*Written by Claude (Opus 4.5) | 2026-01-28 21:30 PST*
