# feat: Global SKILLs Distribution via Vesper and GitHub

## Overview

Enable internal team distribution of skills through a private GitHub repository. Team members can pull skills from a central repo on startup/refresh while maintaining the ability to override skills locally.

**Target Users:** Internal team members at Ather Labs
**Distribution Model:** Pull from central GitHub repository
**Customization:** Local overrides allowed (workspace skills > team skills)
**Authentication:** GitHub Personal Access Token (PAT) - simpler than OAuth for internal tooling

## Problem Statement / Motivation

Currently, Vesper supports skills from multiple sources but has **no mechanism for private team skill distribution**. Team members must manually copy skills or share via ad-hoc methods, leading to version inconsistency across the team.

## Proposed Solution (Simplified MVP)

**Philosophy:** Ship the simplest thing that works. Extend existing code instead of creating new modules.

### What We're Building

1. **One new setting field:** Team Skills Repository URL + PAT
2. **One new function:** Extend existing marketplace code to sync from private repo
3. **Two new IPC handlers:** `team-skills:set-config` and `team-skills:sync`
4. **One UI addition:** Text input + "Sync Now" button in workspace settings

### Precedence Model (Two Levels)

```
Local (workspace skills) > Remote (team skills)
```

That's it. No 5-level hierarchy. Workspace skills override team skills by filename.

## Technical Approach

### Architecture (Minimal)

```
┌─────────────────────────────────────────────────────────────┐
│  Workspace Settings Page                                     │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Team Skills Repository: [owner/repo_____________]       ││
│  │ GitHub Token: [ghp_***************************] [Sync]  ││
│  │ ☑ Sync on startup                                       ││
│  │ Last synced: 2 hours ago • 12 skills                    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
          │
          ▼ Reuses existing marketplace fetch logic
┌─────────────────────────────────────────────────────────────┐
│  ~/.vesper/team-skills/                                      │
│  ├── skill-a/SKILL.md                                       │
│  ├── skill-b/SKILL.md                                       │
│  └── .sync-metadata.json                                    │
└─────────────────────────────────────────────────────────────┘
```

### Implementation (~100 lines of new code)

#### 1. Extend existing IPC handlers in `apps/electron/src/main/ipc.ts`

```typescript
// Add to existing IPC handlers (no new file needed)

const VALID_SKILL_ID = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/;

ipcMain.handle('team-skills:set-config', async (_, config: { repoUrl: string; token: string; syncOnStartup: boolean }) => {
  // Validate repo URL format (owner/repo)
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(config.repoUrl)) {
    return { success: false, error: 'Invalid repository format. Use owner/repo' };
  }

  // Store token encrypted
  await getCredentialManager().set({ type: 'team_skills_token' }, { value: config.token });

  // Store config in preferences
  await updatePreferences({ teamSkills: { repoUrl: config.repoUrl, syncOnStartup: config.syncOnStartup } });

  return { success: true };
});

ipcMain.handle('team-skills:sync', async () => {
  const prefs = await getPreferences();
  const tokenCred = await getCredentialManager().get({ type: 'team_skills_token' });

  if (!prefs.teamSkills?.repoUrl || !tokenCred) {
    return { success: false, error: 'Team skills not configured' };
  }

  const [owner, repo] = prefs.teamSkills.repoUrl.split('/');
  const result = { added: [] as string[], updated: [] as string[], failed: [] as string[] };

  try {
    // Fetch directory listing from GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents`,
      {
        headers: {
          Authorization: `Bearer ${tokenCred.value}`,
          Accept: 'application/vnd.github.v3+json'
        },
        signal: AbortSignal.timeout(30000)
      }
    );

    if (response.status === 401) return { success: false, error: 'Invalid token or access revoked' };
    if (response.status === 404) return { success: false, error: 'Repository not found' };
    if (!response.ok) return { success: false, error: `GitHub API error: ${response.status}` };

    const contents = await response.json();
    const skillDirs = contents.filter((item: any) => item.type === 'dir');

    // Download each skill
    for (const dir of skillDirs) {
      // Security: Validate skill ID
      if (!VALID_SKILL_ID.test(dir.name)) {
        result.failed.push(`${dir.name}: invalid skill ID`);
        continue;
      }

      try {
        const skillMdUrl = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${dir.name}/SKILL.md`;
        const skillResponse = await fetch(skillMdUrl, {
          headers: { Authorization: `Bearer ${tokenCred.value}` },
          signal: AbortSignal.timeout(10000)
        });

        if (!skillResponse.ok) {
          result.failed.push(`${dir.name}: no SKILL.md found`);
          continue;
        }

        const content = await skillResponse.text();

        // Security: Size limit (1MB max)
        if (content.length > 1024 * 1024) {
          result.failed.push(`${dir.name}: exceeds size limit`);
          continue;
        }

        // Write atomically (temp file + rename)
        const skillDir = join(TEAM_SKILLS_DIR, dir.name);
        const tempPath = join(skillDir, `SKILL.md.${Date.now()}.tmp`);

        await mkdir(skillDir, { recursive: true });
        await writeFile(tempPath, content);
        await rename(tempPath, join(skillDir, 'SKILL.md'));

        result.added.push(dir.name);
      } catch (e) {
        result.failed.push(`${dir.name}: ${e instanceof Error ? e.message : 'download failed'}`);
      }
    }

    // Update sync metadata
    await writeFile(
      join(TEAM_SKILLS_DIR, '.sync-metadata.json'),
      JSON.stringify({ lastSync: Date.now(), skillCount: result.added.length })
    );

    // Broadcast skills changed
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('skills:changed');
    });

    return { success: true, ...result };

  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Sync failed' };
  }
});
```

#### 2. Add team skills to existing skill loading in `packages/shared/src/skills/storage.ts`

```typescript
// Add after loadWorkspaceSkills, before loadGlobalSkills

export function loadTeamSkills(): LoadedSkill[] {
  const teamSkillsDir = join(homedir(), '.vesper', 'team-skills');
  if (!existsSync(teamSkillsDir)) return [];

  return loadSkillsFromDir(teamSkillsDir, 'team');
}

// Update loadAllSkills to include team skills
export function loadAllSkills(workspaceRoot: string): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  const seenSlugs = new Set<string>();

  // 1. Workspace skills (local overrides)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skills.push({ ...skill, source: 'workspace' });
    seenSlugs.add(skill.slug);
  }

  // 2. Team skills (NEW - from private GitHub repo)
  for (const skill of loadTeamSkills()) {
    if (!seenSlugs.has(skill.slug)) {
      skills.push({ ...skill, source: 'team' });
      seenSlugs.add(skill.slug);
    }
  }

  // 3. Global + Claude Code skills (existing)
  // ... rest unchanged
}
```

#### 3. Extend SkillSource type

```typescript
// packages/shared/src/skills/types.ts
export type SkillSource = 'workspace' | 'team' | 'global' | 'claude-code';
```

#### 4. Add UI to WorkspaceSettingsPage

```tsx
// Add to apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx
// In the existing settings sections

<SettingsSection title="Team Skills">
  <div className="space-y-4">
    <div className="space-y-2">
      <Label>GitHub Repository</Label>
      <Input
        placeholder="owner/repo"
        value={teamSkillsRepo}
        onChange={(e) => setTeamSkillsRepo(e.target.value)}
      />
    </div>
    <div className="space-y-2">
      <Label>Personal Access Token</Label>
      <Input
        type="password"
        placeholder="ghp_..."
        value={teamSkillsToken}
        onChange={(e) => setTeamSkillsToken(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Create a token with "repo" scope at github.com/settings/tokens
      </p>
    </div>
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Switch checked={syncOnStartup} onCheckedChange={setSyncOnStartup} />
        <Label>Sync on startup</Label>
      </div>
      <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
        Sync Now
      </Button>
    </div>
    {lastSync && (
      <p className="text-sm text-muted-foreground">
        Last synced {formatDistanceToNow(lastSync)} • {skillCount} skills
      </p>
    )}
  </div>
</SettingsSection>
```

## Security Hardening

### Required Validations

1. **Skill ID validation:** `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$` - no path traversal
2. **Size limit:** 1MB max per SKILL.md
3. **Token storage:** Encrypted via CredentialManager
4. **Atomic writes:** Temp file + rename pattern
5. **Timeout:** 30s for API calls, 10s for individual skill downloads
6. **No symlinks:** `lstat` check before write (add in v2 if needed)

### Error Handling

- Invalid token → "Invalid token or access revoked"
- Repo not found → "Repository not found"
- Rate limited → "GitHub API rate limit exceeded. Try again in X minutes"
- Network error → "Network error. Check your connection"
- Partial failure → Return list of failed skills with reasons

## Acceptance Criteria

### MVP (Ship This)

- [x] User can enter repo URL and PAT in workspace settings
- [x] "Sync Now" fetches skills from private repo
- [x] Skills appear in skill list and work in agent
- [x] Workspace skills override team skills with same name
- [x] Token stored encrypted
- [x] Skill IDs validated (no path traversal)

### Deferred to v2

- OAuth flow (use PAT for now)
- Conflict resolution UI (local wins, no UI needed)
- Update notifications (user clicks Sync when they want updates)
- Source badges in UI (not essential)
- Orphaned skill detection (let users manage files)
- Rate limit handling module (handle inline)
- ETag caching (premature optimization)

## Files Changed

| File | Change |
|------|--------|
| `apps/electron/src/main/ipc.ts` | +2 IPC handlers (~80 lines) |
| `packages/shared/src/skills/storage.ts` | +loadTeamSkills function (~15 lines) |
| `packages/shared/src/skills/types.ts` | Add 'team' to SkillSource |
| `packages/shared/src/config/paths.ts` | Add TEAM_SKILLS_DIR constant |
| `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx` | +UI section (~40 lines) |

**Total: ~150 lines of new code across 5 files**

## Success Metrics

- **Adoption:** Team members can sync skills within 5 minutes of setup
- **Reliability:** Sync works first try for 95%+ of users
- **Simplicity:** No new dependencies, no new modules, extends existing patterns

## References

- Existing marketplace: `apps/electron/src/main/ipc.ts:2600-2884`
- Skill loading: `packages/shared/src/skills/storage.ts`
- Credential storage: `packages/shared/src/credentials/manager.ts`

---

*Generated: 2026-01-25 (Simplified based on DHH/Kieran/Simplicity reviews)*
*Complexity reduced from ~1500 lines to ~150 lines*
