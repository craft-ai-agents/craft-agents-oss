# Feature: Terminal Resume Button for Claude Agent SDK Sessions

## Overview

Add a button in the chat input area that spawns a new terminal window with the current Claude Agent SDK session auto-resumed using `claude --resume <session-id>`. This feature enables users to seamlessly continue their Vesper AI conversations in the command-line interface while maintaining full session context.

**User Story:** As a Vesper user, I want to resume my current AI session in a terminal so that I can leverage Claude Code CLI's advanced features (parallel agents, task lists, direct file system access) without losing my conversation context.

## Problem Statement / Motivation

Currently, Vesper sessions exist only within the Electron app UI. Power users who want to:
- Run parallel sub-agents for complex tasks
- Use task list environment variables (`CLAUDE_CODE_TASK_LIST_ID`)
- Execute long-running operations in the background
- Access terminal-specific Claude Code features

...must manually find the session ID and launch Claude Code CLI separately, which is cumbersome and breaks their workflow.

## Proposed Solution

Integrate a "Open in Terminal" button into the chat input area that:

1. **Detects platform** (macOS, Windows, Linux) and spawns the appropriate terminal emulator
2. **Validates session state** ensuring SDK session ID exists and Claude CLI is installed
3. **Automatically resumes** the current session by executing `claude --resume <sdk-session-id>`
4. **Sets working directory** to the session's `sdkCwd` or `workingDirectory`
5. **Injects environment variables** including optional `CLAUDE_CODE_TASK_LIST_ID` for task list integration
6. **Provides clear feedback** via loading states and toast notifications

### User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User has active Vesper session with messages             │
│     (SDK session ID captured after first agent response)    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  2. User clicks Terminal icon button in chat input area     │
│     Button shows loading spinner                            │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Main process validates:                                  │
│     - Claude CLI installed (via which/where command)        │
│     - SDK session ID exists                                 │
│     - Working directory accessible                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Platform-specific terminal spawned:                      │
│     macOS:    AppleScript → Terminal.app or iTerm2          │
│     Linux:    gnome-terminal / konsole / xterm              │
│     Windows:  Windows Terminal / PowerShell / cmd           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Terminal opens with command:                             │
│     cd <working_dir>                                         │
│     export CLAUDE_CODE_TASK_LIST_ID=<vesper_session_id>      │
│     claude --resume <sdk_session_id>                         │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  6. Success toast shown: "Terminal opened with session"     │
│     User continues conversation in CLI                      │
└─────────────────────────────────────────────────────────────┘
```

## Technical Approach

### Architecture

```
┌───────────────────────────────────────────────────────────────┐
│  Renderer Process (React)                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  FreeFormInput.tsx                                       │  │
│  │  ┌─────────────────────────────────────────────────┐    │  │
│  │  │  TerminalResumeButton                            │    │  │
│  │  │  - Shows Terminal icon (lucide-react)           │    │  │
│  │  │  - Manages loading state                        │    │  │
│  │  │  - Invokes IPC: session:resumeInTerminal        │    │  │
│  │  └─────────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────┬────────────────────────────────────┘
                           │ IPC (contextBridge)
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  ipc.ts - Handler: session:resumeInTerminal             │  │
│  │  1. Validate session ID format (prevent injection)      │  │
│  │  2. Check session exists and has sdkSessionId           │  │
│  │  3. Verify Claude CLI installed                         │  │
│  │  4. Get working directory (sdkCwd preferred)            │  │
│  │  5. Call platform-specific spawn function               │  │
│  └──────────────────────┬──────────────────────────────────┘  │
│                         │                                      │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  terminal.ts - Platform-specific spawning               │  │
│  │  - openMacTerminal(): AppleScript + osascript           │  │
│  │  - openLinuxTerminal(): x-terminal-emulator fallback    │  │
│  │  - openWindowsTerminal(): wt.exe or cmd.exe             │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌───────────────────────────────────────────────────────────────┐
│  System Terminal Emulator                                      │
│  Executes: claude --resume <sdk_session_id>                   │
│  With:                                                         │
│    - CWD: session's sdkCwd or workingDirectory                │
│    - ENV: CLAUDE_CODE_TASK_LIST_ID=<vesper_session_id>         │
└───────────────────────────────────────────────────────────────┘
```

### File Changes

#### 1. Add New Files

**`apps/electron/src/main/terminal.ts`** (~200 lines)
```typescript
// Platform-specific terminal spawning logic
export async function spawnTerminalWithSession(options: {
  sdkSessionId: string
  workingDirectory: string
  taskListId?: string
}): Promise<{ success: boolean; error?: string }>

function openMacTerminal(command: string): Promise<void>
function openLinuxTerminal(command: string): Promise<void>
function openWindowsTerminal(command: string): Promise<void>
```

**`apps/electron/src/renderer/components/app-shell/input/TerminalResumeButton.tsx`** (~100 lines)
```tsx
// Button component with loading state and tooltip
export function TerminalResumeButton({
  sessionId,
  sdkSessionId,
  workingDirectory,
  disabled
}: TerminalResumeButtonProps)
```

#### 2. Modify Existing Files

**`apps/electron/src/shared/types.ts`**
- Add `IPC_CHANNELS.SESSION_RESUME_IN_TERMINAL = 'session:resumeInTerminal'`
- Add `ElectronAPI.resumeInTerminal()` method signature

**`apps/electron/src/main/ipc.ts`** (add ~80 lines at line 850)
- Add IPC handler: `ipcMain.handle(IPC_CHANNELS.SESSION_RESUME_IN_TERMINAL, ...)`
- Import `spawnTerminalWithSession` from `terminal.ts`
- Validation logic for session ID, CLI detection, directory existence

**`apps/electron/src/preload/index.ts`** (add ~5 lines at line 92)
- Expose `resumeInTerminal` method via contextBridge

**`apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx`** (modify ~30 lines at line 1350)
- Import and render `<TerminalResumeButton />` in bottom control row
- Position: After working directory badge, before model selector
- Pass props: `sessionId`, `sdkSessionId`, `workingDirectory`, `disabled`

#### 3. Update Dependencies

**`packages/shared/package.json`**
- No new dependencies required (using Node.js built-ins)

### Implementation Phases

#### Phase 1: Core Functionality (MVP)
**Scope:** Basic terminal spawning on macOS only

**Tasks:**
- [x] Create `terminal.ts` with `openMacTerminal()` implementation
  - Use AppleScript via `osascript` to open Terminal.app
  - Execute `claude --resume <session-id>` command
  - Set working directory via `cd` command
  - Handle environment variables with `export`
- [x] Add IPC handler in `ipc.ts`
  - Validate session ID format: `/^ses-[a-f0-9-]+$/`
  - Check session exists via `SessionManager.getSession()`
  - Verify Claude CLI installed: `which claude`
  - Call `spawnTerminalWithSession()` with session data
- [x] Create `TerminalResumeButton.tsx` component
  - Use `<Terminal />` icon from lucide-react
  - Implement loading state with `<Loader2 className="animate-spin" />`
  - Call `window.electronAPI.resumeInTerminal()`
  - Show success/error toasts using `sonner`
- [x] Update `FreeFormInput.tsx` to include button
  - Add button between working directory and model selector
  - Only render if `sdkSessionId` exists
  - Disable if session is processing
- [x] Add IPC types and preload exposure
  - Update `IPC_CHANNELS` enum in `types.ts`
  - Add `resumeInTerminal` to `ElectronAPI` interface
  - Expose via contextBridge in `preload/index.ts`

**Acceptance Criteria:**
- [x] Button appears in chat input area after first message sent
- [x] Clicking button opens Terminal.app on macOS with session resumed
- [x] Terminal opens to correct working directory
- [x] Success toast shown: "Terminal opened with session resumed"
- [x] Button shows spinner during spawn operation (1-2 seconds)
- [x] Error toast shown if Claude CLI not installed

**Status:** ✅ **COMPLETED** - Committed in 2b68bfb (2026-01-24)
**Actual Time:** ~20 minutes (with parallel agent execution)

#### Phase 2: Cross-Platform Support
**Scope:** Windows and Linux terminal spawning

**Tasks:**
- [ ] Implement `openLinuxTerminal()` in `terminal.ts`
  - Try terminal emulators in order: gnome-terminal, konsole, xterm
  - Use `x-terminal-emulator` as fallback (Debian/Ubuntu)
  - Pass command via `--` or `-e` flags depending on terminal
- [ ] Implement `openWindowsTerminal()` in `terminal.ts`
  - Prefer Windows Terminal (`wt.exe`) if available
  - Fallback to PowerShell or cmd.exe
  - Handle path conversion for WSL users (detect and convert)
- [ ] Add platform detection in IPC handler
  - Use `process.platform` to route to correct spawn function
- [ ] Test on Windows 11 and Ubuntu 22.04
  - Verify terminal opens correctly
  - Test command execution
  - Validate environment variable injection

**Acceptance Criteria:**
- [ ] Works on Windows 11 with Windows Terminal
- [ ] Works on Ubuntu 22.04 with gnome-terminal
- [ ] Graceful degradation if preferred terminal not found
- [ ] WSL path translation (if applicable)

**Estimated Time:** 2-3 days

#### Phase 3: Error Handling & Edge Cases
**Scope:** Robust error handling and edge case coverage

**Tasks:**
- [ ] Add Claude CLI detection
  - Use existing `isClaudeCliInstalled()` helper (preload line 160)
  - Show dialog with download link if not installed
  - Cache result to avoid repeated checks
- [ ] Handle missing working directory
  - Check if `sdkCwd` or `workingDirectory` exists
  - Fallback to user's home directory (`process.env.HOME`)
  - Show warning toast about directory change
- [ ] Validate session state before spawning
  - Disable button if session is processing
  - Hide button if no `sdkSessionId` yet
  - Show tooltip explaining why button is disabled
- [ ] Add debounce to prevent multi-spawn
  - 500ms debounce on button clicks
  - Lock button during spawn operation
- [ ] Handle terminal spawn failures
  - Catch errors from `spawn()` call
  - Provide "Copy command" button in error toast
  - Log detailed error for debugging

**Acceptance Criteria:**
- [ ] CLI not installed → Dialog with installation instructions
- [ ] Directory not found → Falls back to home with warning
- [ ] Rapid clicking → Only one terminal spawns
- [ ] Spawn failure → Error toast with copy command option
- [ ] Empty session → Button hidden with no SDK session ID

**Estimated Time:** 1-2 days

#### Phase 4: Task List Integration (Optional)
**Scope:** Support for `CLAUDE_CODE_TASK_LIST_ID` environment variable

**Tasks:**
- [ ] Add `taskListId` to session metadata
  - Update `Session` type in `packages/core/src/types/session.ts`
  - Generate task list ID when session is created (use Vesper session ID)
  - Persist in session JSONL storage
- [ ] Inject environment variable in terminal spawn
  - Add to shell command: `export CLAUDE_CODE_TASK_LIST_ID=<id>`
  - Windows: Use `set CLAUDE_CODE_TASK_LIST_ID=<id>` instead
- [ ] Add settings preference
  - New checkbox in Settings → Workspace: "Enable task list integration"
  - Default: enabled
- [ ] Update button tooltip
  - Show task list ID on hover if enabled
  - Example: "Resume in terminal (Task List: ses-abc123)"

**Acceptance Criteria:**
- [ ] Environment variable set in spawned terminal
- [ ] Variable visible via `echo $CLAUDE_CODE_TASK_LIST_ID` (Unix)
- [ ] Settings toggle controls whether variable is injected
- [ ] Task list ID persists with session

**Estimated Time:** 1-2 days

### Button Placement Mock

```
┌─────────────────────────────────────────────────────────────────────────┐
│  FreeFormInput - Bottom Control Row                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [Textarea for message input]                                           │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│  [📎 Files]  [🔌 Sources]  [📁 Working Dir]  [⏹ Terminal]               │
│                                                                          │
│                                         <spacer>                        │
│                                                                          │
│                                      [🤖 Model ▾]  [↑ Send/⏸ Stop]      │
└─────────────────────────────────────────────────────────────────────────┘
```

**Button Specs:**
- **Icon:** `<Terminal className="h-4 w-4" />` (lucide-react)
- **Variant:** `ghost` (minimal styling to match other badges)
- **Size:** `icon` with `h-7 w-7` (matches Send button)
- **Tooltip:** "Open in Terminal (resume session)"
- **Loading State:** Replace icon with `<Loader2 className="h-4 w-4 animate-spin" />`
- **Disabled State:** Opacity 50%, cursor not-allowed

## Security Considerations

### Command Injection Prevention

**Threat:** Malicious session IDs or directory paths could inject shell commands

**Mitigations:**
1. **Input Validation:**
   ```typescript
   function validateSessionId(id: string): boolean {
     return /^ses-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
   }
   ```

2. **Use spawn() with argument arrays (not exec()):**
   ```typescript
   // ❌ DANGEROUS - shell injection risk
   exec(`claude --resume ${sessionId}`)

   // ✅ SAFE - arguments passed as array
   spawn('claude', ['--resume', sessionId], { shell: false })
   ```

3. **Escape directory paths:**
   ```typescript
   // Use shellwords library or manual escaping
   const escapedPath = path.replace(/'/g, "'\\''")
   ```

### Environment Variable Security

**Threat:** Sensitive data exposed in environment variables

**Mitigations:**
1. Only pass necessary environment variables (don't forward all of `process.env`)
2. Never pass API keys or tokens as env vars (rely on SDK's existing auth)
3. Validate task list IDs before injection

### Permission Boundary

**Question:** Should resumed terminal sessions inherit UI session's permission mode?

**Decision:** No - let terminal use default mode
- Terminal user is power user who can switch modes manually
- Prevents unexpected behavior (user expects CLI defaults)
- Avoids complexity of permission mode synchronization

## Acceptance Criteria

### Functional Requirements

#### Must Have (Phase 1)
- [ ] Button visible in chat input area only when session has `sdkSessionId`
- [ ] Button positioned after working directory badge, before model selector
- [ ] Clicking button spawns Terminal.app on macOS with session resumed
- [ ] Working directory set to session's `sdkCwd` or `workingDirectory`
- [ ] Loading spinner shown during terminal spawn (1-2 seconds)
- [ ] Success toast: "Terminal opened with session resumed"
- [ ] Error toast if Claude CLI not installed: "Claude CLI not found. Install from [link]"
- [ ] Session ID validated before use (regex: `^ses-[a-f0-9-]+$`)
- [ ] Button disabled while session is processing

#### Should Have (Phase 2)
- [ ] Works on Windows 11 with Windows Terminal
- [ ] Works on Ubuntu 22.04 with gnome-terminal
- [ ] Platform detection routes to correct terminal emulator
- [ ] Graceful fallback if preferred terminal not available

#### Could Have (Phase 3-4)
- [ ] Error handling for missing working directory (fallback to home)
- [ ] Debounced button clicks to prevent multi-spawn
- [ ] "Copy command" button in error toasts
- [ ] Task list ID environment variable injection
- [ ] Settings preference for task list integration

### Non-Functional Requirements

**Performance:**
- [ ] Terminal spawns within 2 seconds on all platforms
- [ ] No UI blocking during spawn operation (async IPC)
- [ ] CLI detection cached to avoid repeated disk checks

**Security:**
- [ ] Session ID validated with regex to prevent injection
- [ ] Directory paths properly escaped in shell commands
- [ ] Only necessary environment variables passed to terminal

**Usability:**
- [ ] Clear tooltip explaining button function
- [ ] Accessible via keyboard (tab navigation)
- [ ] Visual feedback during all states (idle, loading, error)

**Compatibility:**
- [ ] macOS 13+ (Apple Silicon and Intel)
- [ ] Windows 11
- [ ] Ubuntu 22.04 LTS

## Dependencies & Risks

### Internal Dependencies
- `SessionManager` - for retrieving session data
- `shell-env.ts` - shell environment loading (already exists)
- `isClaudeCliInstalled()` - CLI detection (already exists in preload)
- Jotai atoms - for accessing current session state

### External Dependencies
- **Claude CLI** must be installed on user's system
- **Terminal emulator** must be available on system
- **Node.js child_process** - for spawning terminals

### Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Claude CLI not installed | High | High | Pre-flight check, show installation instructions |
| Platform-specific terminal syntax | Medium | Medium | Test on all platforms, provide fallbacks |
| Working directory permission issues | Medium | Low | Try directory first, fallback to home on error |
| WSL path translation (Windows) | Medium | Low | Detect WSL, convert paths (Phase 2) |
| Terminal emulator differences (Linux) | Low | Medium | Try multiple terminals in order of preference |

## Success Metrics

**User Adoption:**
- Track button clicks via analytics
- Measure percentage of sessions where button is used
- Survey users for satisfaction (post-release)

**Technical Metrics:**
- Terminal spawn success rate (target: >95%)
- Average spawn time (target: <2 seconds)
- Error rate by platform (target: <5%)

**User Feedback:**
- Issue reports related to terminal integration
- Feature requests for terminal enhancements
- Positive sentiment in user interviews

## Testing Plan

### Unit Tests
- [ ] Session ID validation function
- [ ] Working directory fallback logic
- [ ] Environment variable injection
- [ ] Platform detection routing

### Integration Tests
- [ ] IPC handler end-to-end
- [ ] Terminal spawning (mocked child_process)
- [ ] Error handling flows

### Manual QA

**Test Matrix:**

| Platform | Terminal | Test Case | Expected Result |
|----------|----------|-----------|-----------------|
| macOS 13 | Terminal.app | Click button with valid session | Terminal opens, session resumed |
| macOS 13 | Terminal.app | Click button, CLI not installed | Error dialog with install link |
| macOS 13 | Terminal.app | Click button, directory missing | Terminal opens to home directory |
| Windows 11 | Windows Terminal | Click button with valid session | Terminal opens, session resumed |
| Windows 11 | PowerShell | Click button, wt.exe not found | PowerShell opens as fallback |
| Ubuntu 22.04 | gnome-terminal | Click button with valid session | Terminal opens, session resumed |
| Ubuntu 22.04 | xterm | Click button, gnome not installed | xterm opens as fallback |
| All | All | Empty session (no SDK ID) | Button hidden |
| All | All | Session processing | Button disabled |
| All | All | Rapid clicks (3x) | Only one terminal spawns |

### User Acceptance Testing
- [ ] Beta test with 5-10 power users
- [ ] Collect feedback on button placement
- [ ] Validate error messages are clear
- [ ] Confirm terminal opens to expected location

## Future Enhancements

### Settings & Configuration
- User preference for default terminal app (macOS/Linux)
- Keyboard shortcut: CMD+SHIFT+T (macOS) / CTRL+SHIFT+T (Windows/Linux)
- Option to inherit permission mode from UI session
- Option to auto-open terminal when creating new session

### Advanced Features
- MCP source connection inheritance (terminal gets same sources)
- Task list visualization in Vesper UI (track terminal tasks)
- Bidirectional sync (terminal changes reflected in UI)
- Multiple terminal support (spawn multiple terminals for same session)

### Cross-Application Integration
- Deep link support: `vesper://resume/<session-id>`
- Context menu integration (right-click session → Open in Terminal)
- Command palette action (CMD+K → "Resume in Terminal")

## References & Research

### Internal Code References
- Session atoms: `apps/electron/src/renderer/atoms/sessions.ts:96-130`
- Session types: `packages/core/src/types/session.ts:21` (`sdkSessionId` field)
- Chat input: `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx:1050-1419`
- IPC patterns: `apps/electron/src/main/ipc.ts:851` (openPath example)
- Shell environment: `apps/electron/src/main/shell-env.ts:48` (shell loading)
- CLI detection: `apps/electron/src/preload/index.ts:160` (isClaudeCliInstalled)

### External Documentation
- [Claude Agent SDK Sessions](https://docs.claude.com/en/api/agent-sdk/overview)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Electron IPC Documentation](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Electron shell API](https://www.electronjs.org/docs/latest/api/shell)
- [Node.js child_process.spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
- [Command Injection Prevention](https://auth0.com/blog/preventing-command-injection-attacks-in-node-js-apps/)

### Related Work
- [VS Code Terminal Integration](https://code.visualstudio.com/docs/terminal/basics)
- [iTerm2 Scripting Documentation](https://iterm2.com/documentation-scripting.html)
- [Windows Terminal Command Line Arguments](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments)

### Research Agents
- Repository Research Agent: `a30ddea` (session management, chat input, IPC patterns)
- Best Practices Agent: `a808a87` (terminal opening, security, error handling)
- Framework Docs Agent: `a788738` (SDK resume, Electron APIs, React components)
- SpecFlow Analyzer Agent: `a2a2101` (edge cases, gaps, acceptance criteria)

---

**Plan Created:** 2026-01-23
**Author:** Claude Code (workflows:plan)
**Estimated Total Time:** 5-9 days (across all phases)
**Recommended Approach:** Phased implementation starting with macOS MVP
