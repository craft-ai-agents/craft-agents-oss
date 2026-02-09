---
name: "Update Tracker"
description: "Keeps tracking documents accurate after events — updates 1:1 notes, profiles, goals, projects, and decisions."
---

# Update Tracker Skill

Ensures all tracking documents stay accurate and consistent after events like 1:1s, status changes, or decisions.

## When This Skill Applies

- After a 1:1 meeting
- After a status change on a project or priority
- After a decision is made
- "Update the tracker"
- `/update-tracker`

## Update Workflows

### After a 1:1 Meeting

1. **Create 1:1 note**: Write `people/[name]/1-1s/YYYY-MM-DD-meeting.md` with:
   - Topics discussed
   - Action items (with owners and due dates)
   - Decisions made
   - Follow-ups for next meeting
2. **Update profile** (if needed): Edit `people/[name]/profile.md` if priorities, blockers, or role information changed
3. **Update goals** (if needed): Edit `goals/current.md` if status or blockers changed
4. **Update projects** (if needed): Edit `projects/active/[project].md` if project status discussed

### After a Status Change

1. **Update the source file**: Edit the relevant file (`goals/current.md`, `projects/active/[project].md`, or `people/[name]/profile.md`)
2. **Cross-reference**: Check if the change affects other files and update them too

### After a Decision

1. **Create decision log**: If significant, create `decisions/YYYY-MM-DD-[topic].md` (see decision-logging skill)
2. **Update affected files**: Edit project files, goals, or profiles that are impacted

### Marking Items Complete

- Use strikethrough (`~~item~~`) for completed action items
- Remove resolved blockers or mark them as resolved with a date

## File Conventions

- **1:1 notes**: `people/[name]/1-1s/YYYY-MM-DD-meeting.md`
- **Profiles**: `people/[name]/profile.md`
- **Goals**: `goals/current.md`, `goals/[month]-[year].md`
- **Projects**: `projects/active/[project].md`
- **Decisions**: `decisions/YYYY-MM-DD-[topic].md`

## Rules

1. **Dynamic discovery** — Scan `people/` for names, never hardcode.
2. **Dynamic month** — Always compute the current month tracker filename dynamically.
3. **Read before writing** — Always read the current file content before making edits.
4. **Minimal edits** — Only change what needs updating. Don't reformat or restructure existing content.
5. **Date everything** — All entries should include the date.
6. **Cross-reference** — When updating one file, check if related files also need updates.
7. **Match the user's language** — Write in the same language the user is using.
