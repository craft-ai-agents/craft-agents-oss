# Team Skills

Team skills enable internal distribution of shared skills through a private GitHub repository. This allows teams to maintain a centralized collection of skills that can be synced to all team members' Vesper instances or installed directly with Claude Code CLI.

## Quick Links

- **Vesper Users**: Continue reading this guide for auto-sync setup
- **Claude Code CLI Users**: See [Direct Installation for Claude Code CLI](#direct-installation-for-claude-code-cli) below
- **Official Team Skills Repo**: [github.com/AskTinNguyen/vesper-team-skills](https://github.com/AskTinNguyen/vesper-team-skills)

## Overview

Team skills provide a middle layer in Vesper's skill precedence system:

1. **Workspace skills** (highest priority) - Local overrides specific to a workspace
2. **Team skills** - Shared skills synced from your team's private repository
3. **Claude Code skills** (lowest priority) - Built-in skills from Claude Code CLI

When multiple skills have the same slug (directory name), the skill from the higher priority source takes precedence.

## Features

- **Private repository sync** - Connect to any private GitHub repository
- **Secure credential storage** - GitHub Personal Access Tokens stored with AES-256-GCM encryption
- **On-demand syncing** - Manual sync when you need the latest team skills
- **Skill precedence** - Team skills override Claude Code skills but not workspace-local skills
- **Security validation** - Path traversal protection with strict skill ID validation
- **Auto-broadcast** - Skills automatically refresh in UI after sync

## Setup

### Prerequisites

1. A private GitHub repository containing your team's skills
2. A GitHub Personal Access Token (PAT) with `repo` scope

### Creating a Team Skills Repository

Your GitHub repository should contain skill directories at the root level. Each skill directory must contain a `SKILL.md` file with YAML frontmatter:

```
your-team-skills/
├── skill-1/
│   ├── SKILL.md       # Required
│   └── icon.png       # Optional
├── skill-2/
│   ├── SKILL.md
│   └── icon.svg
└── skill-3/
    └── SKILL.md
```

**Skill directory naming rules:**
- Must match pattern: `[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?`
- Lowercase letters, numbers, and hyphens only
- Must start and end with alphanumeric character
- 2-64 characters long
- No path traversal attempts (e.g., `../`, `./`)

**SKILL.md format:**

```markdown
---
name: Skill Name
description: Brief description of what this skill does
icon: 🚀  # Optional: emoji or URL
globs:    # Optional: file patterns that trigger this skill
  - "**/*.tsx"
  - "**/*.ts"
alwaysAllow:  # Optional: tools to always allow
  - Read
  - Grep
---

# Skill Instructions

Your skill instructions go here...
```

### Getting a GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name (e.g., "Vesper Team Skills")
4. Select the `repo` scope (full control of private repositories)
5. Click "Generate token"
6. Copy the token immediately (you won't be able to see it again)

### Configuring Team Skills in Vesper

1. Open Vesper Settings (CMD+,)
2. Navigate to **Workspace** → **Team Skills** section
3. Click **Configure** button
4. Enter your repository information:
   - **Repository URL**: `owner/repo` or `https://github.com/owner/repo`
   - **GitHub Personal Access Token**: Paste your PAT
5. Click **Save & Sync**

The configuration will be saved and skills will be synced automatically.

## Usage

### Syncing Team Skills

After initial configuration, you can sync team skills at any time:

1. Open Vesper Settings (CMD+,)
2. Navigate to **Workspace** → **Team Skills**
3. Click the **Sync** button
4. Wait for sync to complete

You'll see a success notification showing how many skills were synced.

### Viewing Team Skills

Team skills appear in the skills list with a "Team" badge:

1. Open the Skills panel in Vesper
2. Look for skills with the **Team** badge
3. Team skills are available to all sessions in the workspace

### Using Team Skills in Sessions

Team skills work exactly like workspace and Claude Code skills:

- **Automatic activation**: Skills with `globs` patterns activate automatically when matching files are open
- **Manual invocation**: Use the skill by name in your chat (e.g., "use the code-review skill")
- **Permission inheritance**: Team skills inherit the session's permission mode

### Overriding Team Skills

If you need to customize a team skill for your workspace:

1. Copy the skill directory from `~/.vesper/team-skills/{skill-name}/` to your workspace skills directory
2. Edit the `SKILL.md` file as needed
3. Your workspace version will take precedence over the team version

## Storage Locations

Team skills are stored separately from workspace and Claude Code skills:

| Skill Type | Storage Location |
|------------|------------------|
| Workspace skills | `~/.vesper/workspaces/{workspace-id}/skills/` |
| Team skills | `~/.vesper/team-skills/` |
| Claude Code skills | `~/.claude/skills/` |
| Claude Code commands | `~/.claude/commands/` (auto-converted to skills) |

## Configuration Storage

Team skills configuration is stored in two locations:

1. **Repository URL**: `~/.vesper/config.json` → `teamSkillsRepoUrl` field
2. **GitHub PAT**: Encrypted credential manager with type `team_skills_token`

## Security

### Credential Encryption

GitHub Personal Access Tokens are encrypted using AES-256-GCM encryption before being stored on disk. The token is never stored in plain text.

### Path Traversal Protection

All skill directory names are validated against a strict pattern to prevent path traversal attacks:

```typescript
const VALID_SKILL_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/
```

Skills with invalid directory names (e.g., `../evil-skill`, `./bad`) are automatically rejected during sync.

### API Request Timeout

All GitHub API requests have a 30-second timeout to prevent hanging connections.

### HTTPS Only

All GitHub API requests use HTTPS with proper authentication headers.

## Troubleshooting

### Sync Fails with "GitHub API error: 404"

**Causes:**
- Repository doesn't exist
- Repository is private and PAT doesn't have access
- Repository name is misspelled

**Solutions:**
1. Verify the repository URL is correct
2. Ensure your GitHub account has access to the repository
3. Regenerate your PAT with `repo` scope if needed

### Sync Fails with "GitHub API error: 401"

**Causes:**
- Invalid or expired GitHub Personal Access Token
- PAT doesn't have `repo` scope

**Solutions:**
1. Generate a new PAT with `repo` scope
2. Update the configuration in Vesper with the new token

### Sync Fails with "No GitHub token configured"

**Causes:**
- Token was not saved properly
- Credential storage failed

**Solutions:**
1. Re-enter your GitHub PAT in the configuration
2. Click "Save & Sync" again

### Skills Not Appearing After Sync

**Causes:**
- Skills don't have valid `SKILL.md` files
- Skill directory names are invalid
- Skills are being overridden by workspace skills

**Solutions:**
1. Check that each skill directory contains a `SKILL.md` file
2. Verify directory names match the valid pattern: `[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?`
3. Check if a workspace skill with the same slug exists

### Network Timeout During Sync

**Causes:**
- Slow network connection
- Large skill files
- Many skills in repository

**Solutions:**
1. Check your internet connection
2. Retry the sync
3. Consider splitting very large skill repositories

## Best Practices

### Repository Organization

1. **One skill per directory**: Keep each skill self-contained
2. **Clear naming**: Use descriptive slug names that indicate the skill's purpose
3. **Icon files**: Include icon.png or icon.svg for better visual identification
4. **Documentation**: Add detailed instructions in SKILL.md
5. **Version control**: Use Git tags/releases for skill versioning

### Skill Development Workflow

1. **Develop locally**: Create skills in your workspace skills directory first
2. **Test thoroughly**: Ensure the skill works as expected
3. **Commit to team repo**: Add the skill to your team's GitHub repository
4. **Team sync**: Have team members sync to get the latest skills
5. **Iterate**: Update skills in the repo and re-sync as needed

### Team Coordination

1. **Naming conventions**: Establish team conventions for skill slugs
2. **Code review**: Review skill changes before merging to main branch
3. **Change notifications**: Notify team when new skills are added
4. **Sync regularly**: Encourage team members to sync team skills regularly

### Security Best Practices

1. **Rotate PATs**: Regenerate GitHub tokens periodically
2. **Limit token scope**: Only grant `repo` scope, no additional permissions
3. **Private repositories**: Always use private repositories for proprietary skills
4. **Review skill content**: Audit skills for sensitive information before committing

## Migration from Global Skills

If you were previously using the deprecated global skills directory, follow this migration guide:

### Step 1: Identify Global Skills

Global skills were previously stored at `~/.vesper/global-skills/`. This directory is no longer used as of commit `d54b7f0`.

### Step 2: Move Skills to Appropriate Location

You have two options:

**Option A: Move to Claude Code Skills (for personal skills)**

```bash
# Move personal skills to ~/.claude/skills/
mv ~/.vesper/global-skills/* ~/.claude/skills/
```

**Option B: Create Team Skills Repository (for team skills)**

1. Create a new private GitHub repository
2. Copy skill directories to the repository
3. Commit and push to GitHub
4. Configure team skills in Vesper (see Setup section)
5. Sync team skills

### Step 3: Verify Skills Are Loaded

1. Open Vesper
2. Check the Skills panel
3. Verify all skills appear with correct badges:
   - **Workspace** badge for workspace-local skills
   - **Team** badge for team skills from GitHub
   - **CC** badge for Claude Code skills

### Step 4: Clean Up

Once you've verified all skills are working:

```bash
# Remove the old global-skills directory
rm -rf ~/.vesper/global-skills/
```

## Direct Installation for Claude Code CLI

If you're using Claude Code CLI without the Vesper desktop app, you can install team skills directly.

### Quick Start (Claude Code CLI)

```bash
# Clone the official team skills repository
git clone https://github.com/AskTinNguyen/vesper-team-skills ~/.claude/team-skills

# Symlink skills to Claude Code skills directory
mkdir -p ~/.claude/skills
for skill in ~/.claude/team-skills/*/; do
  skill_name=$(basename "$skill")
  if [[ "$skill_name" != "commands" && -f "$skill/SKILL.md" ]]; then
    ln -sf "$skill" ~/.claude/skills/
  fi
done

# Copy commands to Claude Code commands directory
mkdir -p ~/.claude/commands
cp -r ~/.claude/team-skills/commands/* ~/.claude/commands/

# Run optional setup scripts
~/.claude/team-skills/dispatch/setup.sh      # cc and ccd commands
~/.claude/team-skills/github-intel/install.sh # GitHub discovery tools
~/.claude/team-skills/ralph-loop/install.sh   # ralph command
```

### Updating (CLI)

```bash
cd ~/.claude/team-skills && git pull
# Skills update automatically via symlinks
# Commands need to be re-copied
cp -r commands/* ~/.claude/commands/
```

### Alternative: Direct Copy

If symlinks don't work on your system:

```bash
git clone https://github.com/AskTinNguyen/vesper-team-skills /tmp/vesper-team-skills

mkdir -p ~/.claude/skills ~/.claude/commands
for skill in /tmp/vesper-team-skills/*/; do
  skill_name=$(basename "$skill")
  if [[ "$skill_name" != "commands" && -f "$skill/SKILL.md" ]]; then
    cp -r "$skill" ~/.claude/skills/
  fi
done
cp -r /tmp/vesper-team-skills/commands/* ~/.claude/commands/
rm -rf /tmp/vesper-team-skills
```

### Verifying Installation

```bash
# List installed skills
ls ~/.claude/skills/

# List installed commands
ls ~/.claude/commands/
```

For complete CLI installation documentation, see the [vesper-team-skills README](https://github.com/AskTinNguyen/vesper-team-skills).

## API Reference

### IPC Channels

**`team-skills:setConfig`**
- **Input**: `{ repoUrl: string, token: string }`
- **Output**: `{ success: boolean, error?: string }`
- Saves GitHub repository URL and PAT, then triggers initial sync

**`team-skills:sync`**
- **Input**: None
- **Output**: `{ success: boolean, syncedCount?: number, error?: string }`
- Syncs skills from configured GitHub repository

**`team-skills:getStatus`**
- **Input**: None
- **Output**: `{ configured: boolean, repoUrl: string | null, hasToken: boolean, skillCount: number }`
- Returns current team skills configuration status

### Storage Functions

**`loadTeamSkills(): LoadedSkill[]`**
- Loads all skills from `~/.vesper/team-skills/`
- Returns array of `LoadedSkill` objects with `source: 'team'`

**`loadAllSkills(workspaceRoot: string): LoadedSkill[]`**
- Loads skills from all sources with precedence: workspace > team > claude-code
- Deduplicates by slug (first source wins)

## Related Documentation

- [Skills Architecture](../developer/skills-architecture.md) - Technical implementation details
- [Security](../../SECURITY.md) - Security policies and credential storage
- [Workspace Guide](./workspaces.md) - Managing workspaces

## Support

For issues or questions about team skills:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [GitHub Discussions](https://github.com/atherslabs/vesper/discussions)
3. Open an [Issue](https://github.com/atherslabs/vesper/issues) if you find a bug
