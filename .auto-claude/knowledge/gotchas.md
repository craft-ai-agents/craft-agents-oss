# Craft Agents - Gotchas & Pitfalls

## 1. Authentication & Security

### ❌ Mixing Auth Scopes
**Problem**: Using Craft OAuth tokens for MCP servers or vice-versa.
**Rule**: Craft OAuth (`craft_oauth::global`) is ONLY for Craft API. Each MCP server must use its own isolated auth flow.
**Reference**: `packages/core/CLAUDE.md`

### ❌ Local MCP Environment Leakage
**Problem**: Sensitive env vars leaking to spawned MCP subprocesses.
**Mechanism**: The app actively filters `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`, `GITHUB_TOKEN`, etc.
**Solution**: If an MCP server needs specific env vars, they must be explicitly defined in the `env` field of the source config.

## 2. Data & State

### ⚠️ Large Tool Responses
**Behavior**: Responses > 60KB are automatically summarized by a smaller model (Haiku).
**Impact**: Don't rely on raw full-text output for massive datasets in the UI; expect summarization.
**Field**: `_intent` field is injected to preserve context during summarization.

### ⚠️ Message ID Format
**Problem**: Manually creating string IDs.
**Fix**: Always import and use `generateMessageId()` to ensure chronological sorting and collision avoidance.

## 3. Build & Runtime

### ⚠️ Node vs Bun
**Context**: This project uses **Bun**.
**Pitfall**: Using `npm` or `yarn` commands may break lockfiles or scripts.
**Fix**: Always use `bun install`, `bun run`, `bun test`.
