---
name: "Workspace Setup"
description: "Configurar Area de Trabalho — conversational workspace setup that creates a personalized folder structure and templates."
---

# Workspace Setup Skill

Interactive setup wizard that creates a personalized management folder structure based on the user's role, team, and preferences.

## When This Skill Applies

- `/setup`
- First session in a new workspace (auto-triggered)
- "Set up my workspace"
- "Configure workspace"

## Setup Process

### Step 0: Detect Language

Detect the language from the user's message. Default to Portuguese (pt-BR) if no clear signal. Use the detected language for ALL subsequent questions and output.

### Step 1: Ask Questions (One at a Time)

Ask these questions conversationally, one at a time. Wait for each answer before asking the next. Be friendly and explain why each piece of information is useful.

1. **Name** — "What's your name?" (used for templates and preferences)
2. **Role/Title** — "What's your role or title?" (e.g., Engineering Manager, Head of Product)
3. **Company/Organization** — "What company or organization are you at?" (used for folder naming and context)
4. **Direct reports** — "Who are your direct reports? For each person, tell me their name and role." (can be none — the system works for individual contributors too)
5. **Timezone** — "What's your timezone?" (e.g., America/Sao_Paulo, America/New_York)
6. **Folder location** — "Where should I create your management folder? I suggest `~/Documents/{company-slug}/`" (let the user confirm or change)

### Step 2: Create Folder Structure

Use the Bash tool with `mkdir -p` to create the entire structure in one command:

```bash
mkdir -p {path}/goals \
  {path}/context \
  {path}/people/_template/1-1s \
  {path}/meetings/prep \
  {path}/meetings/notes \
  {path}/meetings/recurring \
  {path}/projects/active \
  {path}/projects/archive \
  {path}/decisions \
  {path}/processes \
  {path}/research \
  {path}/inbox \
  {path}/communications \
  {path}/advisory
```

For each direct report, also create:
```bash
mkdir -p {path}/people/{report-slug}/1-1s
```

Where `{report-slug}` is the person's name lowercased with spaces replaced by hyphens.

### Step 3: Write Template Files

Use the Write tool to create each file. Fill placeholders with the user's answers.

#### Core Files

1. **`goals/CLAUDE.md`** — Directory guide explaining the goals folder structure
2. **`goals/current.md`** — Current priorities template with HIGH/MEDIUM/LOW sections
3. **`goals/{month}-{year}.md`** — Monthly tracker for the current month with bets, decisions, action items sections
4. **`context/company.md`** — Company context filled with user's company name, their role
5. **`context/team.md`** — Team overview with each direct report listed (name, role)
6. **`context/stakeholders.md`** — Empty stakeholders template
7. **`people/_template/profile.md`** — Template for person profiles (name, role, started, working style, priorities, concerns)
8. **`people/_template/1-1s/_template.md`** — Template for 1:1 meeting notes (date, topics, action items, follow-ups)

#### Per-Person Files

For each direct report:
9. **`people/{slug}/profile.md`** — Pre-filled with their name and role, rest as placeholders

#### Other Templates

10. **`meetings/notes/_template.md`** — Meeting notes template (date, attendees, agenda, notes, action items)
11. **`inbox/README.md`** — Explains the inbox folder purpose (quick capture, to be processed)
12. **`session-log.md`** — Empty file with header "# Session Log"
13. **`last-session.md`** — Empty file with header "# Last Session"

### Step 4: Update Workspace Configuration

Read the workspace config to find the workspace slug, then update it:

1. **Find the workspace config**: Read `~/.g4os/workspaces/*/config.json` files to find the current workspace (match by checking which one is active, or use the workspace slug from the current working directory)
2. **Set working directory**: Update the workspace config.json to set `defaults.workingDirectory` to the chosen folder path
3. **Mark setup complete**: Set `defaults.setupCompleted` to `true` in the same config.json

Use the Read tool to read the current config, then the Write tool to write the updated version. Preserve all existing fields.

### Step 5: Update User Preferences

Read `~/.g4os/preferences.json` (create if it doesn't exist). Add or update:
- `name`: The user's name
- `timezone`: The user's timezone

### Step 6: Show Summary

Display a summary of what was created:

```markdown
## Setup Complete!

### Your Management Folder
📁 {path}/
├── goals/          — Priorities and monthly trackers
├── context/        — Company and team context
├── people/         — Direct report profiles and 1:1 notes
│   ├── {person-1}/
│   ├── {person-2}/
│   └── _template/
├── meetings/       — Meeting prep, notes, and recurring agendas
├── projects/       — Active and archived project tracking
├── decisions/      — Decision logs
├── processes/      — Process documentation
├── research/       — Research notes
├── inbox/          — Quick capture (to be processed)
├── communications/ — Draft communications
└── advisory/       — Advisory notes

### What's Next?
- Start a new session and try `/start` for your morning brief
- Fill in `context/company.md` with more details about your organization
- Add stakeholders to `context/stakeholders.md`
- Use `/checkpoint` at the end of the day to save progress
```

## Template Content Guidelines

All templates should be:
- **Generalized** — No company-specific content, just structure
- **In the user's language** — Write everything in the language detected in Step 0
- **Minimal but useful** — Enough structure to be immediately useful, not so much that it feels overwhelming
- **Markdown formatted** — Clean, consistent markdown with headers, lists, and tables where appropriate

## Detecting Existing Setup

If the user runs `/setup` and the folder structure already exists:
1. Inform them that a setup was already completed
2. Offer options:
   - **Add more people** — Add new direct reports
   - **Reset** — Delete and recreate everything (ask for confirmation)
   - **Update preferences** — Change name, timezone, or folder location
   - **Skip** — Do nothing

## Rules

1. **One question at a time** — Don't dump all questions at once. This is a conversation.
2. **Respect the user's choices** — If they decline to answer something, use sensible defaults.
3. **No hardcoded content** — All names, roles, and company info come from the conversation.
4. **Idempotent** — Running setup twice shouldn't break anything.
5. **Match the user's language** — All output (questions, templates, summaries) in the detected language.
