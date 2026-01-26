# Session Templates User Guide

**Last Updated:** 2026-01-26
**Version:** 1.0
**Feature Status:** Stable

## Overview

Session Templates allow you to create reusable session configurations for common workflows. Instead of manually configuring skills, permission modes, and settings every time you start a new session, templates let you save these preferences and apply them with one click.

## What Are Session Templates?

Templates are **configuration presets**, not conversation history. They capture:

- **Permission Mode** - safe, ask, or allow-all
- **Skills** - Which skills to attach
- **Model** - Which Claude model to use
- **Thinking Level** - Cognitive processing level (0-5)
- **Working Directory** - Default directory for file operations
- **Task List** - Optional task list for multi-agent workflows
- **Initial Prompt** - Pre-filled message (not auto-sent)
- **Gather Context** - Instructions for Claude about what information to gather from you before starting

Templates do **not** include:
- Previous conversation messages
- Message history
- Specific file attachments

## Template Scopes

Templates can be stored at two levels:

| Scope | Location | Use Case |
|-------|----------|----------|
| **Workspace** | `~/.vesper/workspaces/{id}/templates/` | Project-specific workflows |
| **Global** | `~/.vesper/templates/` | Cross-workspace templates |

When viewing templates, both global and workspace templates are shown together, sorted by usage count.

## Getting Started

### Enabling Templates

Templates are opt-in per workspace:

1. Navigate to **Settings** → **Workspace Settings**
2. Find the **Templates** section
3. Toggle **"Enable session templates"** to ON
4. Click **"Create Default Templates"** to get started with 6 starter templates

### Default Starter Templates

When you enable templates, Vesper creates 6 ready-to-use templates:

#### 1. Code Review
- **Mode:** Safe (read-only)
- **Use case:** Review code changes without making modifications
- **Initial prompt:** "Please review the following code for bugs, security issues, and improvement suggestions:"

#### 2. Feature Build
- **Mode:** Allow-all (full autonomy)
- **Thinking level:** 3 (extended thinking)
- **Use case:** Build new features with minimal friction
- **Gather context:** Asks about what feature to build, requirements, and affected files

#### 3. Bug Investigation
- **Mode:** Safe (read-only)
- **Use case:** Debug issues without making changes
- **Initial prompt:** "Help me investigate this issue:"
- **Gather context:** Asks about the bug, when it occurs, and error messages

#### 4. Documentation
- **Mode:** Ask (prompt for approval)
- **Use case:** Write or improve documentation
- **Gather context:** Asks what needs documentation, type (README/API/inline), and style guidelines

#### 5. Refactoring
- **Mode:** Ask (prompt for approval)
- **Thinking level:** 3 (extended thinking)
- **Use case:** Improve code quality with careful oversight
- **Gather context:** Asks what to refactor, goals, and constraints

#### 6. Quick Question
- **Mode:** Safe (read-only)
- **Thinking level:** 0 (no extended thinking)
- **Use case:** Get fast answers without deep analysis

## Creating Templates

### Method 1: From Workspace Settings (Recommended)

1. Go to **Settings** → **Workspace Settings**
2. Scroll to **Templates** section
3. Click **"+ New Template"**
4. Use the conversational interface to describe your template needs
5. Claude will create the template based on your description

### Method 2: Save from Existing Session

1. Right-click a session in the sidebar
2. Select **"Save as Template"**
3. Choose:
   - **Name** - Short descriptive name
   - **Description** - What the template is for
   - **Scope** - Workspace or Global
   - **Include initial prompt** - Whether to capture the first user message
4. Click **"Save Template"**

This captures the session's current configuration (skills, mode, model, thinking level, working directory).

### Method 3: Create from Scratch

You can also manually create templates by editing JSON files directly:

**Location:** `~/.vesper/templates/{template-id}.json` (global) or `~/.vesper/workspaces/{id}/templates/{template-id}.json` (workspace)

```json
{
  "id": "uuid-here",
  "name": "Code Review",
  "description": "Review code changes with careful analysis in safe mode",
  "scope": "workspace",
  "workspaceId": "workspace-id",
  "permissionMode": "safe",
  "thinkingLevel": 2,
  "initialPrompt": "Please review the following code:\n\n",
  "gatherContext": "Ask the user which files or changes to review, and what specific concerns they have (bugs, security, performance, etc.)",
  "skillIds": ["code-review-skill-id"],
  "createdAt": "2026-01-26T10:00:00Z",
  "updatedAt": "2026-01-26T10:00:00Z",
  "usageCount": 0
}
```

## Using Templates

### Starting a New Session from Template

1. Click **"New Chat"** or press `Cmd+N`
2. In the template picker dialog:
   - Choose **"+ Blank Session"** to skip templates
   - Or select a template card
3. If the template has `gatherContext`, Claude will ask clarifying questions first
4. If the template has `initialPrompt`, it will be pre-filled (you can edit before sending)

### Template Picker Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Start from Template                                    [X] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ + Blank Session     │  │ 📝 Code Review      │          │
│  │                     │  │ Safe mode           │          │
│  │ Start with empty    │  │ Used 12 times       │          │
│  │ configuration       │  │                     │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │ 🔬 Bug Investigation│  │ ✍️ Documentation    │          │
│  │ Safe mode           │  │ Ask mode            │          │
│  │ Used 8 times        │  │ Used 5 times        │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Managing Templates

### Viewing All Templates

1. Go to **Settings** → **Workspace Settings**
2. Scroll to **Templates** section
3. You'll see:
   - **Global Templates** - Available across all workspaces
   - **Workspace Templates** - Specific to this workspace

### Editing Templates

1. In the Templates section, click **[Edit]** next to a template
2. Modify any field:
   - Name and description
   - Permission mode
   - Skills
   - Initial prompt
   - Gather context instructions
3. Save changes

### Deleting Templates

1. In the Templates section, click **[🗑]** (trash icon) next to a template
2. Confirm deletion
3. The template is permanently removed

**Note:** Deleting a template does not affect existing sessions created from it.

## Advanced Features

### Gather Context Field

The `gatherContext` field tells Claude what information to gather from you before starting work:

```json
{
  "gatherContext": "Ask the user: 1) What feature do you want to build? 2) Any specific requirements or constraints? 3) Which files or areas of the codebase are involved?"
}
```

When you use this template, Claude will ask these questions first, then proceed with the task once it has all the context.

**Best practices:**
- Be specific about what information is needed
- Number your questions for clarity
- Focus on information that affects the approach

### Task List Integration

Templates can include a task list ID for multi-agent workflows:

```json
{
  "taskListId": "task-list-uuid"
}
```

When you start a session from this template, it will automatically connect to that task list, allowing multiple agents to coordinate work.

**Use cases:**
- Orchestrate automated workflows
- Team collaboration on complex features
- Parallel task execution

### Usage Count Tracking

Every time you use a template, its usage count increments. Templates are automatically sorted by popularity, so your most-used templates appear first.

To see usage stats:
1. Go to **Settings** → **Workspace Settings** → **Templates**
2. Usage count is shown below each template card

### Schedule Creation Tool

Session templates now support conversational schedule creation via the `schedule_create` tool. This allows Claude to create scheduled tasks from natural language:

**Example conversation:**
```
You: "Remind me to review pull requests every weekday at 10am"
Claude: [uses schedule_create tool]
✓ Schedule "Review PRs" created successfully!
Schedule: Every weekday at 10:00 AM
Next run: 2026-01-27T10:00:00Z
```

**Supported frequencies:**
- Hourly - Runs every hour at specified minute
- Daily - Runs every day at specified time
- Weekdays - Runs Mon-Fri at specified time
- Weekly - Runs on specific day of week
- Monthly - Runs on specific day of month
- Custom - Raw cron expression

The tool validates schedules to prevent:
- Scheduling in the past
- Sub-minute intervals
- Exceeding 100 schedules per workspace

## Workflows

### Workflow 1: Code Review Template

**Setup:**
1. Create template with:
   - Mode: Safe
   - Skills: None (or code review skill if you have one)
   - Initial prompt: "Please review the following code for bugs, security issues, and improvement suggestions:\n\n"
   - Gather context: "Ask the user which files to review and what specific concerns they have"

**Usage:**
1. Start new session → Select "Code Review" template
2. Claude asks: "Which files would you like me to review? What concerns do you have?"
3. You: "Review src/auth.ts for security issues"
4. Claude analyzes in safe mode, provides feedback without making changes

### Workflow 2: Feature Build Template

**Setup:**
1. Create template with:
   - Mode: Allow-all
   - Thinking level: 3
   - Skills: Your preferred development skills
   - Gather context: "Ask what feature to build, requirements, and affected files"

**Usage:**
1. Start new session → Select "Feature Build" template
2. Claude asks for feature details, requirements, constraints
3. You provide context
4. Claude builds the feature autonomously with extended thinking

### Workflow 3: Team Documentation Template (Global)

**Setup:**
1. Create **global** template with:
   - Mode: Ask
   - Initial prompt: Empty (let Claude guide)
   - Gather context: "Ask what needs documentation, target audience, and style guidelines"

**Usage:**
1. Any team member, any workspace: Start session → Select "Documentation" template
2. Consistent documentation process across all projects
3. Claude adapts to project-specific needs while following team guidelines

## Best Practices

### 1. Use Descriptive Names
✅ Good: "Code Review - Security Focus"
❌ Bad: "Template 1"

### 2. Add Detailed Descriptions
Help future you remember what each template is for:
```json
{
  "description": "Review code changes with emphasis on security vulnerabilities, input validation, and authentication issues"
}
```

### 3. Use Global Templates for Cross-Project Workflows
Templates that work across all projects should be global:
- Code review processes
- Documentation standards
- General debugging approaches

### 4. Use Workspace Templates for Project-Specific Needs
Templates tied to a specific codebase should be workspace-scoped:
- Project-specific build scripts
- Custom testing workflows
- Domain-specific tasks

### 5. Leverage Gather Context
Don't hard-code assumptions. Use `gatherContext` to make templates flexible:
```json
{
  "gatherContext": "Ask: 1) Which module to refactor? 2) Performance goals? 3) Backward compatibility requirements?"
}
```

### 6. Start with Default Templates
The 6 default templates cover most common use cases. Customize them instead of creating from scratch.

### 7. Review and Archive
Periodically review your templates:
- Delete unused templates (low usage count)
- Update descriptions as workflows evolve
- Archive outdated templates by deleting them

## Troubleshooting

### Template Not Appearing in Picker

**Cause:** Templates feature not enabled for workspace
**Solution:**
1. Go to Settings → Workspace Settings
2. Toggle "Enable session templates" ON

### Template Skills Not Loading

**Cause:** Skill IDs in template no longer exist
**Solution:**
1. Edit the template
2. Re-select the skills
3. Save changes

### Initial Prompt Not Pre-Filled

**Cause:** Template was saved without `includeInitialPrompt: true`
**Solution:**
1. Edit the template
2. Add/update the `initialPrompt` field manually

### Can't Delete Template

**Cause:** File permissions issue
**Solution:**
```bash
# Check file permissions
ls -la ~/.vesper/templates/
# Or for workspace templates
ls -la ~/.vesper/workspaces/{id}/templates/

# Fix permissions if needed
chmod 644 ~/.vesper/templates/{template-id}.json
```

### Template Changes Not Syncing

**Cause:** File locking conflict
**Solution:**
1. Close all Vesper windows
2. Delete lock files: `rm ~/.vesper/templates/*.lock`
3. Reopen Vesper

## API Reference

For programmatic template management, see [API Documentation](../api/templates.md).

## Related Features

- [Task Lists](./task-lists.md) - Multi-agent workflow coordination
- [Skills](../../README.md#skills) - Extend agent capabilities
- [Permission Modes](../../README.md#permission-modes) - Control agent autonomy
- [Scheduler](../features/scheduler.md) - Automated recurring sessions

## Examples

### Example 1: Research Template

```json
{
  "id": "research-template",
  "name": "Deep Research",
  "description": "In-depth research with web search and extended thinking",
  "scope": "global",
  "permissionMode": "ask",
  "thinkingLevel": 4,
  "skillIds": ["web-search-skill-id"],
  "gatherContext": "Ask the user: 1) What topic to research? 2) What specific questions need answering? 3) Any sources to prioritize?",
  "createdAt": "2026-01-26T10:00:00Z",
  "updatedAt": "2026-01-26T10:00:00Z",
  "usageCount": 0
}
```

### Example 2: Testing Template

```json
{
  "id": "testing-template",
  "name": "Test Suite Builder",
  "description": "Create comprehensive test suites with TDD approach",
  "scope": "workspace",
  "workspaceId": "my-workspace-id",
  "permissionMode": "allow-all",
  "thinkingLevel": 3,
  "workingDirectory": "/Users/you/projects/my-app/tests",
  "initialPrompt": "Let's build a test suite for:\n\n",
  "gatherContext": "Ask: 1) Which module to test? 2) What test framework (Jest, Vitest, etc.)? 3) Coverage requirements?",
  "createdAt": "2026-01-26T10:00:00Z",
  "updatedAt": "2026-01-26T10:00:00Z",
  "usageCount": 0
}
```

### Example 3: Deployment Template

```json
{
  "id": "deploy-template",
  "name": "Production Deployment",
  "description": "Safe deployment checklist with approval gates",
  "scope": "workspace",
  "workspaceId": "my-workspace-id",
  "permissionMode": "ask",
  "thinkingLevel": 2,
  "taskListId": "deploy-checklist-task-list",
  "gatherContext": "Ask: 1) What version to deploy? 2) Any feature flags to toggle? 3) Rollback plan confirmed?",
  "createdAt": "2026-01-26T10:00:00Z",
  "updatedAt": "2026-01-26T10:00:00Z",
  "usageCount": 0
}
```

## Feedback

Found an issue or have a suggestion? Please report it in the [GitHub Issues](https://github.com/atherslabs/vesper/issues) with the label `templates`.

---

**Maintained by:** Vesper Team
**Last Updated:** 2026-01-26
**Version:** 1.0
