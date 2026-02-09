---
name: "Project Update"
description: "Standard format and workflow for updating project tracking documents — status changes, progress, blockers, decisions."
---

# Project Update Skill

Manages project tracking files with consistent format and update workflows.

## When This Skill Applies

- "Update project X status"
- "Record progress on [project]"
- "Mark [project] as blocked/complete"
- After meetings where project status changed
- `/project-update`

## Project File Location

- Active projects: `projects/active/[project-name].md`
- Completed projects: `projects/archive/[project-name].md`
- Template (if exists): `projects/active/_template.md`

## Standard Project File Format

```markdown
# [Project Name]

## Overview
- **Status**: On track / At risk / Blocked / Complete
- **Owner**: [Name]
- **Started**: [Date]
- **Target**: [Date or milestone]

## Goal
[One sentence: what does success look like?]

## Current State
[2-3 sentences: where are we now?]

## Blockers
- [Blocker 1]: [who can unblock] - [status]
- None currently

## Next Steps
1. [ ] [Action] - [owner] - [due date]
2. [ ] [Action] - [owner] - [due date]

## Dependencies
- [Dependency]: [status]

## Key Decisions
| Date | Decision | Rationale |
|------|----------|-----------|
| [Date] | [What] | [Why] |

## Updates Log
### [Date]
- [What changed]
- [Progress made]
- [Issues encountered]
```

## Status Definitions

| Status | Meaning | Action |
|--------|---------|--------|
| **On track** | Progress as expected | Continue normal monitoring |
| **At risk** | May miss target | Needs attention, discuss in 1:1 |
| **Blocked** | Cannot progress | Escalate, find unblock path |
| **Complete** | Goal achieved | Move to archive with outcome |

## Update Workflows

### When Status Changes
1. Read current project file
2. Update Status field
3. Add entry to Updates Log with date
4. Update Blockers section if applicable
5. Adjust Next Steps

### When Adding Progress
1. Add dated entry to Updates Log
2. Check off completed Next Steps
3. Add new Next Steps if identified
4. Update Current State if significantly changed

### When Project Completes
1. Set Status to "Complete"
2. Add final Updates Log entry with outcome
3. Move file from `active/` to `archive/`
4. Update any related files (goals, people profiles)

### When Recording Decisions
Add to Key Decisions table and optionally create `decisions/YYYY-MM-DD-[topic].md`

## Rules

1. **Read before writing** — Always read the current file before making edits.
2. **Date every update** — All Updates Log entries must have dates.
3. **Next Steps need owners** — Every action item should have an owner and due date.
4. **Keep Blockers current** — Remove resolved blockers, don't let them go stale.
5. **Match the user's language** — Write updates in the same language the user is using.
