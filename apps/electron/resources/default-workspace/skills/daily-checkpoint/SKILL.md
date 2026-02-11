---
name: "Daily Checkpoint"
description: "Macro checkpoint — scans all sessions from today, compares with logs, and updates session-log, activity-log, local-context, and workspace-context."
alwaysAllow: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
---

# Daily Checkpoint Skill

Scans all sessions from the day, cross-references with existing logs, and updates/complements/cleans everything that needs it. This is the "end of day" consolidated checkpoint.

## When to Use

- `/daily-checkpoint` — at the end of the work day
- "Close out the day" / "Consolidate everything"
- When there were many short sessions and individual checkpoints didn't run

## Files This Skill Manages

**Input (read):**
- `~/.g4os/workspaces/{workspace}/sessions/YYMMDD-*/session.jsonl` — metadata from all today's sessions

**Output — Working Directory:**
- `session-log.md` — consolidated daily entry (one entry = one day)
- `activity-log.md` — significant activities not yet logged
- `last-session.md` — overwrite with consolidated daily summary
- `local-context.md` — update active projects and project notes

**Output — Workspace:**
- `~/.g4os/workspaces/{workspace}/workspace-context.md` — update contacts, terminology, preferences

**Conditional Output — Downstream files (discovered via Step 0):**
- Any tracking documents, project files, or structured directories found during context discovery

## Process

### Step 0: Discover Working Directory Context Structure (Sub-agent)

**Before anything else**, launch a sub-agent (Task, subagent_type=Explore) to discover the context structure of the working directory:

```
Prompt: "Read the CLAUDE.md at the root of the working directory and all CLAUDE.md files
in subdirectories (scan for **/CLAUDE.md up to 2 levels deep).

Also scan for any structured tracking documents (e.g., goals/, people/, projects/,
reports/, or similar directories with their own conventions).

Return a JSON map with:
1. directories: list of directories with CLAUDE.md and what each one tracks
2. tracking_files: list of structured files that track status, priorities, or people
3. key_workflows: workflows documented in CLAUDE.md files (e.g., 'after 1:1 update profile',
   'weekly report saves to reports/')
4. conventions: any formatting or update rules specified in CLAUDE.md files

If no CLAUDE.md or structured directories exist, return empty lists — this is expected
for simple workspaces."
```

This sub-agent runs **in parallel** with Step 1 (session collection).

The result is the **context map** — it determines which downstream files the skill should check and potentially update. If the working directory has no special structure, Steps 3 and 5 will only handle the core log files.

### Step 1: Collect Today's Sessions (Sub-agent in parallel)

Launch **in parallel with Step 0** a sub-agent (Task, subagent_type=Bash) to collect metadata from all sessions:

```bash
TODAY=$(date +"%y%m%d")
WORKSPACE_DIR=$(find ~/.g4os/workspaces -maxdepth 0 -type d 2>/dev/null)
# Determine the active workspace sessions directory dynamically

for dir in ~/.g4os/workspaces/*/sessions/${TODAY}-*/; do
  sid=$(basename "$dir")
  meta=$(head -1 "$dir/session.jsonl" 2>/dev/null)
  # Extract: id, name, preview, messageCount, sources, workingDirectory,
  #          createdAt, lastUsedAt, costUsd, labels, todoState
done
```

For each session, extract from the **first line** of `session.jsonl`:
- `id` — session identifier
- `name` — generated title (what was done)
- `preview` — user's first message
- `messageCount` — interaction volume
- `enabledSourceSlugs` — which sources were used
- `workingDirectory` — where the session operated
- `createdAt` / `lastUsedAt` — timestamps (convert to local time)
- `tokenUsage.costUsd` — session cost
- `labels` — session tags
- `todoState` — todo status

### Step 2: Classify Sessions

Classify each session into one of these categories:

| Category | Criteria | Action |
|----------|----------|--------|
| **Substantive** | messageCount >= 10, or relevant tool usage for the working directory | Must be in the log |
| **Operational** | Session focused on config/setup, skills, sources | Brief summary (1 line) |
| **Trivial** | messageCount < 5, no significant tool calls, or different working directory | Skip in log |

**Rule:** If a session's `workingDirectory` doesn't match the current working directory, the session is probably not relevant for this log — mark as trivial unless it has clearly relevant content.

### Step 3: Compare with Logs and Discovered Context (Parallel sub-agents)

Use the **context map** from Step 0 to launch **multiple sub-agents in parallel**, each checking a dimension:

**Sub-agent A — Logs (always required) (Task, subagent_type=general-purpose):**
```
Read session-log.md, activity-log.md, and local-context.md from the working directory.
Given this summary of today's sessions [paste summary from Steps 1+2], identify:
1. Which substantive sessions are already reflected in session-log?
2. Which activity-log entries from today are OK / redundant / missing?
3. Which projects in local-context.md changed status based on the sessions?
Return a JSON with: {reflected: [], gaps: [], activity_ok: [], activity_redundant: [],
activity_missing: [], project_changes: []}
```

**Sub-agent E — Workspace Context (always required) (Task, subagent_type=general-purpose):**
```
Read workspace-context.md from the workspace directory.
Given this summary of today's sessions [paste summary], identify:
1. New contacts mentioned (name, role, company)
2. New acronyms or terms used
3. Existing contact information that changed
4. New recurring items or cadence changes
Return: {new_contacts: [], new_terms: [], contact_changes: [],
recurring_changes: []}
```

**Conditional sub-agents — Only launch if Step 0 discovered relevant directories:**

For each structured directory discovered in Step 0 (e.g., goals/, people/, projects/), launch a sub-agent that:
1. Reads the CLAUDE.md for that directory to understand its conventions
2. Reads the relevant tracking files
3. Compares against today's session summary
4. Returns changes needed

Example for a `goals/` directory:
```
Read goals/CLAUDE.md and goals/current.md.
Given this session summary [paste], identify:
1. Items that changed status
2. New action items or completed items
3. Priority changes
Return: {status_changes: [], new_items: [], completed: [], priority_changes: []}
```

Example for a `people/` directory:
```
Scan people/*/profile.md.
Given this session summary [paste], identify:
1. Any profiles needing updates
2. Missing meeting notes
3. Recurring patterns or flags
Return: {profiles_to_update: [{person, changes}], missing_notes: [], flags: []}
```

### Step 4: Present Diagnostic to User

Consolidate sub-agent results and present:

```markdown
## Daily Diagnostic — [Date]

### Sessions Found: [N]
| # | Session | Name | Msgs | Cost | Category |
|---|---------|------|------|------|----------|
| 1 | 260210-smart-shore | Changing context logic | 115 | $7.64 | Substantive |
| 2 | ... | ... | ... | ... | ... |

### Total Cost for Today: $X.XX

### Sessions Already Reflected in Log
- [list from Sub-agent A]

### Sessions NOT Reflected (gaps)
- [list from Sub-agent A]

### Suggested Updates

**Logs:**
- **session-log.md**: [create/update entry with X, Y, Z]
- **activity-log.md**: [add/remove entries]
- **last-session.md**: [overwrite]
- **local-context.md**: [project X changed status]

**Workspace:**
- **workspace-context.md**: [new contact/acronym]

**Downstream files (if discovered):**
- [List changes per discovered directory, following each directory's conventions]

### Items to Remove/Clean
- [obsolete entries in activity-log]
- [completed projects in local-context]
```

**Wait for user confirmation before proceeding.** The user may adjust, add context, or correct classifications.

### Step 5: Execute Updates (Parallel sub-agents)

After confirmation, launch **multiple sub-agents in parallel** to execute the updates:

**Group 1 — Logs (in parallel):**

Sub-agent for `session-log.md`:
- If no entry exists for today: create new entry
- If one already exists: update/complement (don't duplicate)
- Format: follow the existing pattern in the file
- One entry = one day (consolidates all sessions)

Sub-agent for `activity-log.md`:
- Add significant activities that weren't logged
- Remove entries redundant with the updated session-log
- Keep only entries from the last 5 days (clean older ones)

Sub-agent for `last-session.md`:
- Overwrite with today's consolidated summary
- Compact format for fast-load by session-start

**Group 2 — Context files (in parallel):**

Sub-agent for `local-context.md`:
- Update active project statuses
- Add newly mentioned projects
- Remove completed or irrelevant projects

Sub-agent for `workspace-context.md`:
- Add new contacts, acronyms, terminology
- Update information that changed
- Keep concise (~50-80 lines)

**Group 3 — Downstream files (in parallel, only if changes were identified):**

For each downstream file with approved changes, launch a sub-agent that:
- Receives clear instructions on what to change (based on the approved diagnostic)
- Follows the CLAUDE.md rules for that directory
- Makes no changes beyond what was approved

**Important:** Each sub-agent receives minimal necessary context — the session summary and clear instructions. Each sub-agent should be autonomous. Do not make changes beyond what was approved.

### Step 6: Final Summary

Present what was done:

```markdown
## Consolidated Checkpoint — [Date]

**Sessions processed:** X of Y
**Total cost for today:** $X.XX

**Files updated:**
| File | Action |
|------|--------|
| session-log.md | [created/updated entry] |
| activity-log.md | [N added, M removed] |
| last-session.md | [overwritten] |
| local-context.md | [X changes] |
| workspace-context.md | [X changes] |
| [downstream files] | [changes per file] |

**Next Session Focus:**
> [What to prioritize tomorrow, based on today's sessions]
```

## Rules

1. **One entry per day in session-log** — Multiple sessions consolidate into a single entry
2. **Don't fabricate** — If there's not enough information in the metadata to understand what a session did, classify as "Operational" and summarize in 1 line
3. **Diagnostic first, execution second** — Always present what will change and wait for approval
4. **Respect what exists** — If the session-log already has a good entry for today, complement it, don't rewrite
5. **Curation > completeness** — A concise, useful log is better than an exhaustive log nobody reads
6. **Activity-log is ephemeral** — Keep only the last 5 days. Older entries should already be in session-log
7. **Match the user's language** — Write everything in the language the user is using
8. **Sessions from other directories** — Only log them if they had direct impact on the current working directory
9. **Respect directory CLAUDE.md files** — Each directory may have its own CLAUDE.md with specific rules. When updating a downstream file, follow that directory's conventions
10. **Sub-agents receive minimal necessary context** — Pass session summary and clear instructions, not entire context. Each sub-agent should be autonomous

## Sub-agent Architecture

```
Daily Checkpoint (orchestrator)
├── Step 0+1 (PARALLEL)
│   ├── Sub-agent Explore: Discover context structure (CLAUDE.md files)
│   └── Sub-agent Bash: Collect session metadata
│
├── Step 2: Classify (orchestrator, no sub-agent)
│
├── Step 3 (PARALLEL - 2 required + N conditional sub-agents)
│   ├── A: Compare logs (always)
│   ├── E: Compare workspace-context (always)
│   └── [Conditional]: One sub-agent per discovered structured directory
│
├── Step 4: Diagnostic (orchestrator, consolidate results)
│
├── Step 5 (PARALLEL - 3 groups)
│   ├── Group 1: session-log + activity-log + last-session
│   ├── Group 2: local-context + workspace-context
│   └── Group 3: downstream files (conditional, based on discovery)
│
└── Step 6: Final summary (orchestrator)
```

**Parallelism rule:** Launch sub-agents using multiple `Task` tool calls in the same message. This ensures real simultaneous execution.

## Integration with Other Skills

- **session-checkpoint**: Daily-checkpoint is the superset — runs session-checkpoint for the current session AND scans all others
- **session-start**: The next session-start will read the updated last-session.md and activity-log.md
- **workspace-context**: Step 5 updates workspace-context with new contacts/terms
- **quick-log**: Quick-log entries from during the day are incorporated into the diagnostic
