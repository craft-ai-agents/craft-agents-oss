---
name: "Workflow Builder"
description: "Create new G4 workflows from scratch or convert Claude Code / Codex plugins into workflows"
alwaysAllow: ["Read", "Write", "Glob", "Grep", "WebFetch", "WebSearch"]
---

# Workflow Builder

Build new G4 OS workflows from scratch, or convert existing Claude Code SDK skills, Codex plugins, or any AI agent instructions into fully-structured G4 workflows.

## When This Skill Applies

- "Create a workflow for X"
- "Convert this plugin into a workflow"
- "I have a Claude Code skill I want to turn into a workflow"
- "Build a workflow from this prompt/instructions"
- `/workflow-builder`

## Modes

### Mode 1: Create From Scratch

When the user wants to build a new workflow from an idea or description.

### Mode 2: Convert Plugin/Skill

When the user provides:
- A Claude Code SDK `SKILL.md` file
- A Codex plugin definition
- An OpenAI GPT instruction set
- A custom system prompt or agent instructions
- Any structured AI instructions they want to adapt

---

## Workflow Anatomy (Reference)

Every G4 workflow lives at:
```
~/.g4os/workspaces/{workspace}/workflows/{slug}/
├── WORKFLOW.md              # Required: Main workflow definition
└── knowledge/               # Optional: Domain knowledge files
    ├── {topic-1}.md
    └── {topic-2}.md
```

### WORKFLOW.md Structure

```yaml
---
name: "Display Name"
description: "One-line description shown in workflow list"
icon: "emoji"
---
```

Followed by markdown body with:
1. **Title & purpose** — What this workflow does
2. **Workflow steps** — Numbered steps with clear instructions
3. **Output format** — Expected deliverable structure
4. **Rules/guardrails** — What to do and not do

### Knowledge Files

Separate files in `knowledge/` for domain expertise that:
- Is reusable across workflow steps
- Contains reference material (checklists, frameworks, templates)
- Would bloat the main WORKFLOW.md if inlined
- Might be updated independently

---

## Process: Create From Scratch

### Step 1: Understand Intent

Ask the user:
1. **What does this workflow do?** (the core job)
2. **Who triggers it and when?** (e.g., "when I receive a contract", "weekly on Mondays")
3. **What sources/integrations does it need?** (Notion, Slack, Google, files, web, etc.)
4. **What's the expected output?** (report, file, message, decision, etc.)

Keep it to one question if the intent is already clear from context.

### Step 2: Research (if needed)

If the workflow involves a domain you're not expert in:
- Use WebSearch to find best practices, frameworks, templates
- Check existing workflows in the workspace for patterns to reuse
- Review relevant G4 OS sources that the workflow will integrate with

### Step 3: Design the Workflow

Before writing files, present the design to the user:

```
## Workflow Design: {name}

**Slug**: `{slug}`
**Trigger**: /slug or description of when it activates
**Sources used**: [list]

### Steps
1. [Step name] — [what happens]
2. [Step name] — [what happens]
3. [Step name] — [what happens]

### Knowledge files
- `{topic}.md` — [what it contains]

### Output
[What the user gets at the end]
```

Wait for user confirmation before writing files.

### Step 4: Write the Files

1. Create the workflow directory
2. Write `WORKFLOW.md` with full instructions
3. Write knowledge files if needed
4. Validate the workflow structure

### Step 5: Validate & Test

- Confirm the directory structure is correct
- Verify YAML frontmatter parses correctly
- Check that referenced sources exist in the workspace
- Offer to do a dry run with sample input

---

## Process: Convert Plugin/Skill

### Step 1: Ingest the Source Material

Accept the plugin in any format:
- **File path** — Read the file directly
- **Pasted content** — Parse from conversation
- **URL** — Fetch from web (GitHub repo, docs page, etc.)

### Step 2: Analyze the Plugin

Extract and map these elements:

| Plugin Element | Maps To |
|---------------|---------|
| Name/title | `name` in frontmatter |
| Description | `description` in frontmatter |
| System prompt / instructions | WORKFLOW.md body (workflow steps) |
| Tools/actions used | Sources needed + alwaysAllow |
| Knowledge/context files | `knowledge/*.md` files |
| Input format | Step 1 of workflow |
| Output format | Final step + output template |
| Constraints/rules | Rules section in WORKFLOW.md |
| Examples | Examples section or knowledge file |

Present a mapping summary:

```
## Conversion Analysis

**Source**: [plugin name/type]
**Target slug**: `{slug}`

### What transfers directly
- [element] → [where it goes]

### What needs adaptation
- [element] — [why and how to adapt]

### What's missing (G4-specific)
- [thing to add] — [why it's needed]

### Sources required
- [source] — [what it's used for]
```

### Step 3: Adapt for G4 OS

Key adaptations when converting:

1. **Tool references** — Map generic tool calls to G4 OS MCP tools:
   - "search the web" → `WebSearch`
   - "read a file" → `Read` tool
   - "call an API" → specific MCP source tools
   - Use the pattern `mcp__{source-slug}__{tool-name}` for MCP tools (e.g., `mcp__notion__search`, `mcp__slack__conversations_history`, `mcp__google-workspace__get_events`)

2. **Output format** — Adapt to G4 rendering:
   - Tables → `datatable` or `spreadsheet` fences
   - Diagrams → `mermaid` fences
   - JSON → `json` fences (rendered as tree view)
   - Reports → structured markdown with proper headers

3. **Interaction pattern** — G4 workflows follow:
   - Accept input → Process → Present → Confirm → Act
   - Never skip the "present and confirm" step for destructive actions

4. **Context** — Add G4-specific context:
   - Reference user preferences (timezone, language, communication style)
   - Reference available sources and their capabilities
   - Reference the workspace structure if the workflow creates/reads files

### Step 4: Write & Validate

Same as "Create From Scratch" Steps 4-5.

---

## Quality Checklist

Before finalizing any workflow, verify:

- [ ] **Frontmatter** is valid YAML with name, description, icon
- [ ] **Slug** is lowercase, alphanumeric, hyphens only
- [ ] **Steps are numbered** and follow a logical sequence
- [ ] **Output format** is clearly defined with a template
- [ ] **Rules/guardrails** prevent common mistakes
- [ ] **Sources referenced** actually exist in the workspace
- [ ] **Knowledge files** don't duplicate what's in WORKFLOW.md
- [ ] **Workflow is self-contained** — someone reading it can execute without guessing
- [ ] **Disclaimers** are present if the workflow touches sensitive domains (legal, financial, medical)

## Writing Style for Workflows

- **Be imperative**: "Ask the user for...", "Extract the following...", "Generate a report..."
- **Be specific**: Include exact field names, formats, templates
- **Be defensive**: Add "If X is missing, then Y" fallback instructions
- **Show examples**: Include good/bad examples for ambiguous output
- **Keep WORKFLOW.md focused**: Domain knowledge goes in `knowledge/` files
- **Match the user's preferences**: Concise, direct, action-oriented

## File Paths

- **Workflows**: `~/.g4os/workspaces/{workspace}/workflows/{slug}/`
- **Skills**: `~/.g4os/workspaces/{workspace}/skills/{slug}/`
- **Sources**: `~/.g4os/workspaces/{workspace}/sources/{slug}/`
- **Docs**: `~/.g4os/docs/`
