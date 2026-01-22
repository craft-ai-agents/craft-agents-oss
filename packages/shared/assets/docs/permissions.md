# Permissions Configuration Guide

This guide explains how to configure custom permission rules for Explore mode.

## Overview

Explore mode is a read-only mode that blocks potentially destructive operations.
Custom permission rules let you allow specific operations that would otherwise be blocked.

Permission files are located at:
- Workspace: `~/.craft-agent/workspaces/{slug}/permissions.json`
- Source: `~/.craft-agent/workspaces/{slug}/sources/{source}/permissions.json`

## Auto-Scoping for Source Permissions

**Important:** MCP patterns in a source's `permissions.json` are automatically scoped to that source.

When you write:
```json
{ "pattern": "list", "comment": "Allow list operations" }
```

The system converts it to `mcp__<sourceSlug>__.*list` internally. This means:
- Simple patterns like `list` only affect tools from that source
- No risk of accidentally allowing `list` tools from other sources
- Workspace-level patterns still apply globally (for intentional cross-source rules)

## permissions.json Schema

```json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "Allow list operations" },
    { "pattern": "get", "comment": "Allow get operations" },
    { "pattern": "search", "comment": "Allow search operations" }
  ],
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests" },
    { "method": "POST", "path": "^/search", "comment": "Search POST" }
  ],
  "allowedBashPatterns": [
    { "pattern": "^ls\\s", "comment": "Allow ls commands" }
  ],
  "blockedTools": [
    "dangerous_tool"
  ],
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**"
  ]
}
```

## Rule Types

### allowedMcpPatterns

Regex patterns for MCP tool names to allow in Explore mode.

For **source-level** permissions.json, use simple patterns (auto-scoped):
```json
{
  "allowedMcpPatterns": [
    { "pattern": "list", "comment": "All list operations for this source" },
    { "pattern": "get", "comment": "All get operations for this source" },
    { "pattern": "search", "comment": "All search operations for this source" }
  ]
}
```

For **workspace-level** permissions.json (global rules), use full patterns:
```json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__.*__list", "comment": "List operations across all sources" }
  ]
}
```

### allowedApiEndpoints

Fine-grained rules for API source requests.

```json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests" },
    { "method": "POST", "path": "^/search", "comment": "Search POST" },
    { "method": "POST", "path": "^/v1/query$", "comment": "Query endpoint" }
  ]
}
```

### allowedBashPatterns

Regex patterns for bash commands to allow.

```json
{
  "allowedBashPatterns": [
    { "pattern": "^ls\\s", "comment": "ls commands" },
    { "pattern": "^git\\s+status", "comment": "git status" },
    { "pattern": "^pwd$", "comment": "pwd command" }
  ]
}
```

### blockedTools

Additional tools to block (rarely needed).

```json
{
  "blockedTools": ["risky_tool_name"]
}
```

### allowedWritePaths

Glob patterns for directories where writes are allowed.

```json
{
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**",
    "/path/to/project/output/**"
  ]
}
```

## Default Behavior in Explore Mode

**Blocked by default:**
- Bash commands (except read-only commands listed below)
- Write, Edit, MultiEdit tools
- MCP tools with write semantics (create, update, delete)
- API POST/PUT/DELETE requests

**Allowed by default:**
- Read, Glob, Grep
- WebFetch, WebSearch
- TodoWrite
- MCP tools with read semantics (list, get, search)
- Plans folder writes (session plans only)

### Read-Only Bash Commands

These commands are allowed in Explore mode without custom configuration:

| Category | Commands |
|----------|----------|
| **File exploration** | `ls`, `tree`, `cat`, `head`, `tail`, `file`, `stat`, `wc`, `du`, `df` |
| **Search** | `find`, `grep`, `rg`, `ag`, `fd`, `locate`, `which` |
| **Git (read-only)** | `git status`, `git log`, `git diff`, `git show`, `git branch`, `git blame`, `git reflog` |
| **GitHub CLI** | `gh pr view/list`, `gh issue view/list`, `gh repo view` |
| **Package managers** | `npm ls/list/outdated`, `yarn list`, `pip list`, `cargo tree` |
| **System info** | `pwd`, `whoami`, `env`, `ps`, `uname`, `hostname`, `date` |
| **Text processing** | `jq`, `yq`, `sort`, `uniq`, `cut`, `column` |
| **Network diagnostics** | `ping`, `dig`, `nslookup`, `netstat` |
| **Version checks** | `node --version`, `python --version`, etc. |

### Compound Commands

Compound commands using `&&`, `||`, and `|` are **allowed** when all parts are safe:

| Construct | Example | Behavior |
|-----------|---------|----------|
| **Logical AND** | `git status && git log` | ✅ Allowed if both commands are safe |
| **Logical OR** | `git status \|\| echo "failed"` | ✅ Allowed if both commands are safe |
| **Pipes** | `git log \| head` | ✅ Allowed if all commands are safe |

Each command is validated independently. If any command is not in the allowlist, the entire compound command is blocked.

### Blocked Shell Constructs

These constructs are always blocked, even if the base command is allowed:

| Construct | Examples | Why Blocked |
|-----------|----------|-------------|
| **Background execution** | `&` | Runs asynchronously, could hide activity |
| **Redirects** | `>`, `>>` | Could overwrite files |
| **Command substitution** | `$()`, backticks, `<()`, `>()` | Execute embedded commands |
| **Control characters** | newlines, carriage returns | Act as command separators |

Example: `git status > file.txt` is blocked because `>` could overwrite files.

## Cascading Rules

Rules cascade from workspace → source → agent:
1. Workspace rules apply globally
2. Source rules extend workspace rules for that source
3. Agent rules extend both for that agent's session

Rules are additive - they can only allow more operations, not restrict further.

## Best Practices

1. **Be specific with patterns** - Use anchors (^, $) to avoid over-matching
2. **Add comments** - Explain why each rule exists
3. **Test patterns** - Verify regex matches expected tool names
4. **Minimal permissions** - Only allow what's needed

## Examples

### Read-only Linear access:
```json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__linear__(list|get|search)", "comment": "Read operations" }
  ]
}
```

### Search-only API:
```json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*" },
    { "method": "POST", "path": "^/search" }
  ]
}
```

### Safe git commands:
```json
{
  "allowedBashPatterns": [
    { "pattern": "^git\\s+(status|log|diff|branch)", "comment": "Read-only git" }
  ]
}
```

## Planning in Explore Mode

In Explore mode, you can create implementation plans that the user can accept to transition to execution.

### When to Create Plans

Create a plan when:
- The task has multiple complex steps
- You want user approval before making changes
- You've gathered enough context and are ready to implement

### Creating a Plan

1. Write your plan to a markdown file in the session's plans folder
2. Call `SubmitPlan` with the file path
3. The user sees a formatted plan with an "Accept Plan" button
4. Clicking "Accept Plan" exits Explore mode and begins implementation

### Plan Format

```markdown
# Plan Title

## Summary
Brief description of what this plan accomplishes.

## Steps
1. **Step description** - Details and approach
2. **Another step** - More details
3. ...
```

### Explore → Implementation Workflow

The recommended workflow:
1. **Explore** - Read files, search code, understand the codebase
2. **Plan** - Write a structured plan to the plans folder
3. **Submit** - Call `SubmitPlan` to present to user
4. **Accept** - User clicks "Accept Plan" to exit Explore mode
5. **Execute** - Implement the plan with full permissions

This provides a smooth transition from exploration to implementation with user oversight.
