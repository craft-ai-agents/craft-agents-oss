# feat: Global Skills with Claude Code Sync and GitHub Install

Add global skills support that auto-syncs from Claude Code CLI (`~/.claude/skills/`) and allows installing skills from GitHub URLs or local folders.

## Acceptance Criteria

- [x] Auto-detect and load skills from `~/.claude/skills/` on app startup
- [ ] Watch `~/.claude/skills/` for changes and update in real-time
- [x] Store user-installed global skills at `~/.craft-agent/global-skills/`
- [ ] Install skills from GitHub URLs (e.g., `github.com/user/repo/skills/my-skill`)
- [ ] Import skills from local folder paths via file picker
- [x] Global skills available across all workspaces
- [x] Workspace skills override global skills when same slug exists
- [x] UI distinguishes global vs workspace skills with badges
- [ ] Show "Override" indicator when workspace skill shadows global

## Context

**Current State:**
- Skills are workspace-specific only (`~/.craft-agent/workspaces/{id}/skills/`)
- Skills use Agent Skills standard: `SKILL.md` with YAML frontmatter
- Full infrastructure exists: storage, IPC, ConfigWatcher, UI components

**Key Files:**
- `packages/shared/src/skills/storage.ts` - Skill loading/parsing
- `packages/shared/src/skills/types.ts` - `LoadedSkill`, `SkillMetadata` types
- `packages/shared/src/config/watcher.ts` - ConfigWatcher for live updates
- `packages/shared/src/config/paths.ts` - `CONFIG_DIR` constant
- `apps/electron/src/main/ipc.ts` - IPC handlers (`SKILLS_GET`, etc.)
- `apps/electron/src/renderer/atoms/skills.ts` - Jotai state
- `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` - UI

**Skill Format (Same as Claude Code):**
```yaml
---
name: skill-name
description: What it does and when to use it
globs: ["*.py"]           # Optional
alwaysAllow: ["bash"]     # Optional
icon: "emoji-or-url"      # Optional
---

# Instructions in markdown...
```

## MVP

### 1. Add Global Skills Path Constants

```typescript
// packages/shared/src/config/paths.ts
export const GLOBAL_SKILLS_DIR = join(CONFIG_DIR, 'global-skills');
export const CLAUDE_CODE_SKILLS_DIR = join(homedir(), '.claude', 'skills');
```

### 2. Extend LoadedSkill Type

```typescript
// packages/shared/src/skills/types.ts
export interface LoadedSkill {
  slug: string;
  metadata: SkillMetadata;
  content: string;
  iconPath?: string;
  path: string;
  source: 'global' | 'workspace' | 'claude-code';  // NEW
}
```

### 3. Add Global Skills Loading

```typescript
// packages/shared/src/skills/storage.ts
export async function loadGlobalSkills(): Promise<LoadedSkill[]> {
  const skills: LoadedSkill[] = [];

  // Load from ~/.craft-agent/global-skills/
  if (existsSync(GLOBAL_SKILLS_DIR)) {
    const installed = await loadSkillsFromDir(GLOBAL_SKILLS_DIR);
    skills.push(...installed.map(s => ({ ...s, source: 'global' as const })));
  }

  // Load from ~/.claude/skills/ (Claude Code)
  if (existsSync(CLAUDE_CODE_SKILLS_DIR)) {
    const claudeCode = await loadSkillsFromDir(CLAUDE_CODE_SKILLS_DIR);
    skills.push(...claudeCode.map(s => ({ ...s, source: 'claude-code' as const })));
  }

  return skills;
}

export async function loadAllSkills(workspaceRoot: string): Promise<LoadedSkill[]> {
  const globalSkills = await loadGlobalSkills();
  const workspaceSkills = await loadWorkspaceSkills(workspaceRoot);

  // Workspace skills override global skills by slug
  const globalSlugs = new Set(workspaceSkills.map(s => s.slug));
  const merged = [
    ...workspaceSkills,
    ...globalSkills.filter(g => !globalSlugs.has(g.slug))
  ];

  return merged;
}
```

### 4. Add GitHub Install IPC Handler

```typescript
// apps/electron/src/main/ipc.ts
ipcMain.handle(IPC.SKILLS_INSTALL_FROM_GITHUB, async (e, url: string) => {
  // Parse GitHub URL: github.com/owner/repo[/tree/branch][/path/to/skill]
  const parsed = parseGitHubSkillUrl(url);
  if (!parsed) throw new Error('Invalid GitHub URL');

  // Clone with shallow depth
  const tempDir = join(tmpdir(), `skill-install-${Date.now()}`);
  await execAsync(`git clone --depth=1 ${parsed.cloneUrl} ${tempDir}`);

  // Find SKILL.md
  const skillPath = parsed.subPath
    ? join(tempDir, parsed.subPath)
    : tempDir;
  const skillMd = join(skillPath, 'SKILL.md');

  if (!existsSync(skillMd)) {
    throw new Error('No SKILL.md found at specified path');
  }

  // Validate and copy to global-skills
  const skill = await loadSkill(skillPath, basename(skillPath));
  const destPath = join(GLOBAL_SKILLS_DIR, skill.slug);
  await cp(skillPath, destPath, { recursive: true });

  // Cleanup temp
  await rm(tempDir, { recursive: true });

  return skill;
});
```

### 5. Add Local Import IPC Handler

```typescript
// apps/electron/src/main/ipc.ts
ipcMain.handle(IPC.SKILLS_IMPORT_FROM_FOLDER, async (e, sourcePath: string) => {
  // Validate SKILL.md exists
  const skillMd = join(sourcePath, 'SKILL.md');
  if (!existsSync(skillMd)) {
    throw new Error('No SKILL.md found in folder');
  }

  // Load and validate
  const slug = basename(sourcePath);
  const skill = await loadSkill(dirname(sourcePath), slug);

  // Copy to global-skills
  const destPath = join(GLOBAL_SKILLS_DIR, skill.slug);
  await cp(sourcePath, destPath, { recursive: true });

  return { ...skill, source: 'global' };
});
```

### 6. Extend ConfigWatcher for Global Skills

```typescript
// packages/shared/src/config/watcher.ts
class ConfigWatcher {
  private globalSkillsWatcher: FSWatcher | null = null;
  private claudeCodeWatcher: FSWatcher | null = null;

  watchGlobalSkills() {
    // Watch ~/.craft-agent/global-skills/
    if (existsSync(GLOBAL_SKILLS_DIR)) {
      this.globalSkillsWatcher = watch(GLOBAL_SKILLS_DIR, { recursive: true },
        debounce(() => this.onGlobalSkillsChange(), 100));
    }

    // Watch ~/.claude/skills/ (Claude Code)
    if (existsSync(CLAUDE_CODE_SKILLS_DIR)) {
      this.claudeCodeWatcher = watch(CLAUDE_CODE_SKILLS_DIR, { recursive: true },
        debounce(() => this.onGlobalSkillsChange(), 100));
    }
  }
}
```

### 7. Update Skills List UI with Badges

```tsx
// apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx
function SkillItem({ skill }: { skill: LoadedSkill }) {
  return (
    <div className="flex items-center gap-2">
      <SkillAvatar skill={skill} />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span>{skill.metadata.name}</span>
          {skill.source === 'claude-code' && (
            <Badge variant="outline" className="text-[10px]">Claude Code</Badge>
          )}
          {skill.source === 'global' && (
            <Badge variant="outline" className="text-[10px]">Global</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{skill.metadata.description}</p>
      </div>
    </div>
  );
}
```

### 8. Add Settings UI for Install Actions

```tsx
// New section in Settings or Skills panel
function GlobalSkillsActions() {
  return (
    <div className="space-y-2">
      <Button onClick={() => showInstallFromGitHubDialog()}>
        Install from GitHub
      </Button>
      <Button onClick={() => showImportFromFolderDialog()}>
        Import from Folder
      </Button>
    </div>
  );
}
```

## References

- Existing skill storage: `packages/shared/src/skills/storage.ts:71-106`
- ConfigWatcher pattern: `packages/shared/src/config/watcher.ts:314-329`
- IPC handler pattern: `apps/electron/src/main/ipc.ts:1488-1499`
- Skills UI: `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx`
- Agent Skills specification: https://agentskills.io/specification
