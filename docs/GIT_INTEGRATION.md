# Git Integration (DIFF-013)

## Overview

The git integration feature adds git status display, stage/unstage functionality, and commit creation to the diff review system.

## Components

### 1. GitStatusIndicator

**Location:** `packages/ui/src/components/git/GitStatusIndicator.tsx`

**Purpose:** Display git status badges for files

**Git Status Types:**
- `staged` - File is staged for commit (green, "S")
- `unstaged` - File has unstaged changes (yellow, "U")
- `untracked` - File is not tracked by git (gray, "?")
- `modified` - File is modified (blue, "M")
- `added` - File is newly added (green, "A")
- `deleted` - File is deleted (red, "D")
- `renamed` - File is renamed (purple, "R")
- `unmodified` - No changes (gray, "")

**Props:**
```typescript
interface GitStatusIndicatorProps {
  status: GitStatus
  className?: string
  showLabel?: boolean  // Show full label text
}
```

**Usage:**
```tsx
<GitStatusIndicator status="staged" showLabel />
```

---

### 2. Git IPC Handlers

**Location:** `apps/electron/src/main/git-operations.ts`

**IPC Channels:**

#### `git:status`
Get git status for all files in working directory
```typescript
const result = await ipcRenderer.invoke('git:status', cwd?: string)
// Returns: { success: boolean, files?: GitFileStatus[], error?: string }
```

#### `git:file-status`
Get git status for a specific file
```typescript
const result = await ipcRenderer.invoke('git:file-status', filePath: string, cwd?: string)
// Returns: { success: boolean, files?: GitFileStatus[], error?: string }
```

#### `git:stage`
Stage a file for commit
```typescript
const result = await ipcRenderer.invoke('git:stage', filePath: string, cwd?: string)
// Returns: { success: boolean, filePath?: string, error?: string }
```

#### `git:unstage`
Unstage a file
```typescript
const result = await ipcRenderer.invoke('git:unstage', filePath: string, cwd?: string)
// Returns: { success: boolean, filePath?: string, error?: string }
```

#### `git:stage-batch`
Stage multiple files at once
```typescript
const result = await ipcRenderer.invoke('git:stage-batch', filePaths: string[], cwd?: string)
// Returns: { success: boolean, error?: string }
```

#### `git:commit`
Create a commit with staged files
```typescript
const result = await ipcRenderer.invoke('git:commit', message: string, cwd?: string)
// Returns: { success: boolean, commitHash?: string, error?: string }
```

#### `git:is-repo`
Check if directory is a git repository
```typescript
const isRepo = await ipcRenderer.invoke('git:is-repo', cwd?: string)
// Returns: boolean
```

---

### 3. DiffReviewSheet Git Integration

**Location:** `packages/ui/src/components/overlay/DiffReviewSheet.tsx`

**New Props:**
```typescript
interface DiffReviewSheetProps {
  // ... existing props
  enableGitIntegration?: boolean      // Enable git features
  gitWorkingDir?: string              // Working directory for git operations
  onStageFile?: (filePath: string) => void    // Callback when file is staged
  onUnstageFile?: (filePath: string) => void  // Callback when file is unstaged
}
```

**Features:**
- **Git status badges** - Shows git status (staged/unstaged/etc) for each file in sidebar
- **Stage/Unstage buttons** - Hover over file in sidebar to show stage/unstage buttons
- **File header status** - Shows git status in file header with Stage/Unstage button

**Usage:**
```tsx
<DiffReviewSheet
  isOpen={isOpen}
  onClose={onClose}
  changes={fileChanges}
  onAcceptAll={handleAcceptAll}
  onRejectAll={handleRejectAll}
  enableGitIntegration={true}
  gitWorkingDir="/path/to/repo"
  onStageFile={(filePath) => console.log('Staged:', filePath)}
  onUnstageFile={(filePath) => console.log('Unstaged:', filePath)}
/>
```

---

### 4. DiffSummaryPanel Git Integration

**Location:** `apps/electron/src/renderer/components/right-sidebar/DiffSummaryPanel.tsx`

**New Props:**
```typescript
interface DiffSummaryPanelProps {
  // ... existing props
  enableGitIntegration?: boolean       // Enable git features
  gitWorkingDir?: string               // Working directory for git operations
  onCommitCreated?: (commitHash: string) => void  // Callback when commit is created
}
```

**Features:**
- **Create Commit button** - Opens commit dialog
- **Commit dialog** - Modal for entering commit message
- **Auto-staging** - Automatically stages accepted files before committing
- **Validation** - Ensures commit message is provided and files are accepted

**Workflow:**
1. User accepts changes via DiffSummaryPanel or DiffReviewSheet
2. User clicks "Create Commit" button
3. Commit dialog opens showing count of accepted files
4. User enters commit message
5. On "Commit" click:
   - All accepted files are staged via `git:stage-batch`
   - Commit is created via `git:commit`
   - Success callback fired with commit hash

**Usage:**
```tsx
<DiffSummaryPanel
  changes={fileChanges}
  onReviewChanges={handleReviewChanges}
  onReviewFile={handleReviewFile}
  onAcceptAll={handleAcceptAll}
  onRejectAll={handleRejectAll}
  changeStatuses={changeStatuses}
  enableGitIntegration={true}
  gitWorkingDir="/path/to/repo"
  onCommitCreated={(hash) => console.log('Commit created:', hash)}
/>
```

---

## Integration Guide

### 1. Enable Git Integration in ChatDisplay

```tsx
// In ChatDisplay component
const [gitWorkingDir, setGitWorkingDir] = useState<string>()

// Check if current directory is a git repo
useEffect(() => {
  async function checkGitRepo() {
    const isRepo = await window.electron?.ipcRenderer.invoke('git:is-repo', process.cwd())
    if (isRepo) {
      setGitWorkingDir(process.cwd())
    }
  }
  checkGitRepo()
}, [])

// Pass to DiffReviewSheet
<DiffReviewSheet
  enableGitIntegration={!!gitWorkingDir}
  gitWorkingDir={gitWorkingDir}
  // ... other props
/>

// Pass to DiffSummaryPanel (via SessionMetadataPanel)
<SessionMetadataPanel
  fileChanges={fileChanges}
  enableGitIntegration={!!gitWorkingDir}
  gitWorkingDir={gitWorkingDir}
  onCommitCreated={(hash) => {
    console.log('Commit created:', hash)
    // Optionally refresh git status
  }}
  // ... other props
/>
```

### 2. Add Git Props to SessionMetadataPanel

```tsx
// In SessionMetadataPanel.tsx
export interface SessionMetadataPanelProps {
  // ... existing props
  enableGitIntegration?: boolean
  gitWorkingDir?: string
  onCommitCreated?: (commitHash: string) => void
}

// Pass through to DiffSummaryPanel
<DiffSummaryPanel
  enableGitIntegration={enableGitIntegration}
  gitWorkingDir={gitWorkingDir}
  onCommitCreated={onCommitCreated}
  // ... other props
/>
```

---

## Testing

### Manual Testing Checklist

1. **Git Status Display**
   - [ ] Open DiffReviewSheet in a git repository
   - [ ] Verify git status badges appear for each file
   - [ ] Verify status is correct (staged/unstaged/modified/etc)

2. **Stage/Unstage Files**
   - [ ] Hover over file in sidebar - stage/unstage buttons appear
   - [ ] Click Stage button - file status changes to "staged"
   - [ ] Click Unstage button - file status changes to "unstaged"
   - [ ] Verify git status in terminal matches UI

3. **File Header Actions**
   - [ ] Select a file in DiffReviewSheet
   - [ ] Verify git status badge appears in file header
   - [ ] Click Stage/Unstage button in header
   - [ ] Verify file status updates

4. **Create Commit**
   - [ ] Accept some changes in DiffSummaryPanel
   - [ ] Click "Create Commit" button
   - [ ] Commit dialog opens with correct file count
   - [ ] Enter commit message
   - [ ] Click "Commit" button
   - [ ] Verify commit is created in git log
   - [ ] Verify commit hash is returned

5. **Error Handling**
   - [ ] Try committing without accepting any files - shows error
   - [ ] Try committing with empty message - button disabled
   - [ ] Try staging non-existent file - shows error
   - [ ] Try operations in non-git directory - gracefully handles

---

## Future Enhancements

- **Git diff view** - Show actual git diff instead of file content comparison
- **Commit history** - View recent commits and their changes
- **Branch management** - Switch branches, create branches
- **Push/pull** - Push commits to remote, pull changes
- **Conflict resolution** - Handle merge conflicts in UI
- **Commit signing** - GPG signature support
- **Amend commits** - Amend last commit
- **Interactive staging** - Stage specific hunks/lines (like `git add -p`)
