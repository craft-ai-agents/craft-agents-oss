---
name: "Workspace Context"
description: "Maintains a curated workspace-context.md — the 'workspace brain' with key contacts, terminology, active projects, and preferences."
---

# Workspace Context Skill

Manages TWO context files with distinct purposes to avoid duplication and keep context functional.

## Two Context Files

### workspace-context.md (global — in workspace)

**Location:** `~/.g4os/workspaces/{workspace}/workspace-context.md`

The user's persistent identity context — follows them regardless of which project/directory they're working in.

**Contains:**
- Key Contacts (names, roles, emails)
- Terminology & Acronyms
- User Preferences & Work Style
- Important Recurring Items (meetings, deadlines)

### local-context.md (project — in working directory)

**Location:** `./local-context.md` (relative to current working directory)

Project-specific context — unique to each working directory.

**Contains:**
- Active Projects and their status
- Frequently Referenced Paths (for this project)
- Project-specific notes, conventions, or reminders

## When This Skill Applies

- "Remember that..." / "Save this for later"
- "Who is [nickname]?" / "What does [acronym] mean?"
- "Update my workspace context"
- `/workspace-context`
- Automatically invoked by `session-start` (Step 1) and `session-checkpoint` (Step 3)

## Templates

### workspace-context.md template

```markdown
# Workspace Context

## Key Contacts
- [Name] ([Role]) — [email or channel]

## Terminology & Acronyms
- [ACRONYM] — [definition]

## User Preferences & Work Style
- [Preferred language, communication style, etc.]

## Important Recurring Items
- [Weekly meetings, deadlines, recurring tasks]
```

### local-context.md template

```markdown
# Local Context

## Active Projects
- [Project name] — [one-line status]

## Frequently Referenced Paths
- [Key files, repos, or directories]

## Project Notes
- [Conventions, reminders, or context specific to this directory]
```

## Where to Store What

| Information | Goes in | Why |
|---|---|---|
| Contact name/role/email | `workspace-context.md` | Global — same person across projects |
| Acronym/terminology | `workspace-context.md` | Global — same meaning everywhere |
| User preferences | `workspace-context.md` | Global — doesn't change per project |
| Recurring meetings | `workspace-context.md` | Global — calendar is calendar |
| Project status | `local-context.md` | Local — specific to this directory |
| File paths | `local-context.md` | Local — paths are project-specific |
| Project conventions | `local-context.md` | Local — each project has its own rules |

## Lookup Flow

When you need context about a contact, acronym, project, or preference:

1. **workspace-context.md** (workspace) — Global context first
2. **local-context.md** (working directory) — Project context
3. **activity-log.md** (working directory) — Recent entries
4. **session-log.md** (working directory) — Historical sessions
5. **Ask the user** — If not found anywhere
6. **Save the answer** — To the appropriate file based on the table above

## Updating

### When to Update

- A new contact, acronym, or project is mentioned for the first time
- A project's status changes significantly
- The user corrects or clarifies context
- During `session-checkpoint` (automatic review)
- When the user explicitly asks to remember something

### How to Update

1. Determine which file the information belongs in (see table above)
2. Read that file (create with template if it doesn't exist)
3. Add, update, or remove the relevant entry
4. Keep files concise — remove stale entries, merge duplicates
5. `workspace-context.md`: ~50-80 lines max
6. `local-context.md`: ~30-50 lines max

### What NOT to Store

- Temporary or one-off information
- Full meeting notes (those belong in dedicated files)
- Detailed project plans (those belong in their own documents)
- Sensitive credentials or API keys
- Logs or session data (those belong in their own files)

## Rules

1. **Curate ruthlessly** — Quick-reference, not a knowledge base.
2. **Keep it current** — Remove outdated entries. Stale context is worse than none.
3. **One line per item** — Each entry should be scannable in a glance.
4. **Match the user's language** — Write entries in the language the user prefers.
5. **Don't duplicate** — Each piece of info lives in ONE place. Reference instead of copying.
6. **Proactive updates** — When you learn something new, offer to save it: "Want me to add [X] to your context?"
7. **Auto-create** — If either file doesn't exist and you need it, create it with the template. Never error.

## Integration with Other Skills

- **session-start**: Reads both files in Step 1 for instant context
- **session-checkpoint**: Reviews and updates both files with new context learned during the session
- **quick-log**: Important context from quick-log entries may warrant a context update
