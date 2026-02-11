---
name: "Workspace Context"
description: "Maintains a curated workspace-context.md — the 'workspace brain' with key contacts, terminology, active projects, and preferences."
---

# Workspace Context Skill

Maintains a curated `workspace-context.md` file that acts as the workspace's persistent memory — a quick-reference "brain" loaded at session start to eliminate cold starts.

## When This Skill Applies

- "Remember that..." / "Save this for later"
- "Who is [nickname]?" / "What does [acronym] mean?"
- "Update my workspace context"
- `/workspace-context`
- Automatically invoked by `session-start` (Step 0) and `session-checkpoint`

## What workspace-context.md Contains

Keep it curated and concise (~50-80 lines). It should contain the **most frequently needed** context:

```markdown
# Workspace Context

## Key Contacts
- [Name] ([Role]) — [nickname/handle], [email or channel]

## Terminology & Acronyms
- [ACRONYM] — [definition]

## Active Projects
- [Project name] — [one-line status], [key files or links]

## User Preferences & Work Style
- [Preferred communication style, review habits, etc.]

## Important Recurring Items
- [Weekly meetings, deadlines, recurring tasks]

## Frequently Referenced Paths
- [Key files, repos, or directories the user works with often]
```

## Lookup Flow

When you need context about a contact, acronym, project, or preference:

1. **workspace-context.md** — Check here first (instant, no tool calls needed if loaded at session start)
2. **activity-log.md** — Search recent entries for context
3. **session-log.md** — Search historical sessions
4. **Ask the user** — If not found anywhere
5. **Update workspace-context.md** — Save the answer for future sessions

## Updating workspace-context.md

### When to Update

- A new contact, acronym, or project is mentioned for the first time
- A project's status changes significantly
- The user corrects or clarifies context
- During `session-checkpoint` (automatic review)
- When the user explicitly asks to remember something

### How to Update

1. Read the current `workspace-context.md`
2. Add, update, or remove the relevant entry in the appropriate section
3. Keep the file concise — remove stale entries, merge duplicates
4. Never exceed ~80 lines — if it's growing too large, archive less-used items

### What NOT to Store

- Temporary or one-off information
- Full meeting notes (those belong in `people/*/1-1s/`)
- Detailed project plans (those belong in `goals/`)
- Sensitive credentials or API keys

## Rules

1. **Curate ruthlessly** — This is a quick-reference, not a knowledge base. Only store what's needed frequently.
2. **Keep it current** — Remove outdated entries. A stale context file is worse than none.
3. **One line per item** — Each entry should be scannable in a glance.
4. **Match the user's language** — Write entries in the language the user prefers.
5. **Don't duplicate** — If information belongs in another file (goals, people, session-log), reference it instead of copying.
6. **Proactive updates** — When you learn something new during a conversation, offer to save it: "Want me to add [X] to your workspace context?"

## Integration with Other Skills

- **session-start**: Reads `workspace-context.md` as Step 0 for instant context
- **session-checkpoint**: Reviews and updates `workspace-context.md` with any new context learned during the session
- **quick-log**: Important context from quick-log entries may warrant a workspace-context update
