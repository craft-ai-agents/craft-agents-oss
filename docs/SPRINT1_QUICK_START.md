# Sprint 1: GitHub Integration - Quick Start Guide

This guide helps you get started with Vesper's GitHub integration feature in Sprint 1.

## What's New in Sprint 1

✅ **GitHub OAuth Authentication** - Securely connect your GitHub account
✅ **Daily Reports** - Auto-detect issues, PRs, and team members from your repositories
✅ **Real-Time Sync** - Live updates as you work with GitHub
✅ **Workspace Settings** - Configure GitHub per workspace

## Quick Setup (5 minutes)

### 1. Configure GitHub OAuth

First, set up a GitHub OAuth app:

```bash
# Copy the environment template
cp .env.example .env

# Add GitHub OAuth credentials to .env
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret
```

**Need credentials?** Follow [GITHUB_INTEGRATION.md](./GITHUB_INTEGRATION.md)

### 2. Start the Application

```bash
# Development mode with hot reload
bun run electron:dev

# Or build and run
bun run electron:start
```

### 3. Connect GitHub

1. Open Vesper
2. Go to **Workspace Settings** > **GitHub Integration**
3. Click **Connect**
4. Authorize in GitHub browser popup
5. Configure your repository:
   - Repository Owner: (e.g., `atherslabs`)
   - Repository Name: (e.g., `vesper`)
   - Look Back (Days): 1-30

### 4. Generate Your First Report

1. Click **Daily Report** button (or use CMD+Shift+R)
2. Select your repository owner and name
3. Click **Generate Report**
4. Review the auto-detected issues and PRs
5. Click **Submit Report**

Done! You now have a daily report ready for triage in Sprint 2.

## Features in Sprint 1

### GitHub OAuth Flow

- 🔐 Secure PKCE-based authentication
- 🔄 Token automatically stored encrypted
- 🚀 <5 minutes from signup to first report
- ⚙️ Easy disconnect from settings

### Daily Reports

- 📊 Auto-detect open issues
- 📋 Detect pull requests
- 👥 List team members
- 🔍 Customize look-back period (1-30 days)
- 💾 Reports automatically saved locally

### Settings Integration

- ⚙️ Per-workspace GitHub configuration
- 🔗 Connection status display
- 📝 Repository owner/name fields
- 🔌 Easy disconnect option

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         Vesper Electron App              │
├─────────────────────────────────────────┤
│                                         │
│  Frontend Layer                         │
│  ┌─────────────────────────────────┐   │
│  │ GitHubConnectModal              │   │  IPC Channels:
│  │ DailyReportModal                │   │  • github:startOAuth
│  │ GitHubSettingsSection           │   │  • github:getStatus
│  │ (Jotai state management)        │   │  • report:create
│  └─────────────────────────────────┘   │  • report:submit
│           ↓ IPC ↑                       │  • orchestration:event
│  Main Process Layer                     │
│  ┌─────────────────────────────────┐   │
│  │ OrchestrationService (Main)     │   │
│  │ • GitHub OAuth                  │   │
│  │ • Daily Report Collection       │   │
│  │ • Real-time Events              │   │
│  └─────────────────────────────────┘   │
│           ↓ HTTP ↑                      │
│  Shared Business Logic                  │
│  ┌─────────────────────────────────┐   │
│  │ @vesper/shared/github            │   │
│  │ • OAuth flow                    │   │
│  │ • REST API client               │   │
│  │ • Daily report service          │   │
│  │ • Storage & persistence         │   │
│  └─────────────────────────────────┘   │
│           ↓ HTTPS ↑                     │
│  External Services                      │
│  ┌─────────────────────────────────┐   │
│  │ GitHub API (OAuth & REST)       │   │
│  └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## Development Workflow

### Enable GitHub in Development

```bash
# Ensure env vars are set
export GITHUB_OAUTH_CLIENT_ID="your-client-id"
export GITHUB_OAUTH_CLIENT_SECRET="your-client-secret"

# Run dev server
bun run electron:dev
```

### Type Checking

```bash
# Full type check
bun run typecheck:all

# Just shared package
cd packages/shared && bun run tsc --noEmit
```

### Testing

```bash
# Run tests
bun test

# Tests for GitHub integration
bun test packages/shared/src/github/__tests__/*.test.ts

# Watch mode
bun test --watch
```

## File Structure

```
packages/shared/src/github/          # Backend business logic
├── types.ts                         # Data models
├── oauth.ts                         # GitHub OAuth flow
├── client.ts                        # REST API wrapper
├── daily-report.ts                  # Report service
├── storage.ts                       # Persistence layer
└── __tests__/                       # Unit tests (16 passing)

apps/electron/src/
├── main/
│   ├── orchestration.ts             # Main process service
│   └── ipc.ts                       # IPC handlers (+9 channels)
├── preload/
│   └── index.ts                     # Preload bridge (IPC API)
└── renderer/
    ├── atoms/
    │   └── orchestration.ts         # Jotai state management
    ├── components/
    │   └── orchestration/
    │       ├── GitHubConnectModal.tsx
    │       ├── DailyReportModal.tsx
    │       └── GitHubSettingsSection.tsx
    └── hooks/
        └── useOrchestrationEvents.ts # Event listener hook
```

## IPC Channels (New in Sprint 1)

### GitHub OAuth

```typescript
// Start OAuth flow
await window.electronAPI.githubStartOAuth()
// Returns: { success, accessToken, login, email }

// Get connection status
await window.electronAPI.githubGetStatus(workspaceId)
// Returns: { isConnected, login, email, connectedAt }

// Update connection status
await window.electronAPI.githubSetStatus(workspaceId, status)
```

### Daily Reports

```typescript
// Create report from GitHub
await window.electronAPI.reportCreate({
  repoOwner: 'string',
  repoName: 'string',
  sinceDays?: number,
  teamCapacity?: { availableDevelopers, hoursPerDay }
})
// Returns: DailyReport object

// Submit report for triage
await window.electronAPI.reportSubmit(report)
// Returns: Submitted DailyReport

// Get latest report
await window.electronAPI.reportGetLatest(workspaceId)
// Returns: DailyReport | null
```

### Events

```typescript
// Listen for orchestration events
window.electronAPI.onOrchestrationEvent((event) => {
  switch(event.type) {
    case 'connection-status-updated':
      // Handle GitHub connection change
      break
    case 'report-created':
      // Handle new report
      break
    case 'report-submitted':
      // Handle submission
      break
    case 'error':
      // Handle error
      break
  }
})
```

## Common Tasks

### Get User's GitHub Connection Status

```typescript
import { useAtom } from 'jotai';
import { githubConnectionAtom } from '@/atoms/orchestration';

function MyComponent() {
  const [connection] = useAtom(githubConnectionAtom);

  return (
    <div>
      {connection?.isConnected ? (
        <p>Connected as {connection.login}</p>
      ) : (
        <p>Not connected to GitHub</p>
      )}
    </div>
  );
}
```

### Listen for Real-Time Updates

```typescript
import { useOrchestrationEvents } from '@/hooks/useOrchestrationEvents';

function MyComponent() {
  useOrchestrationEvents((event) => {
    if (event.type === 'report-submitted') {
      console.log('Report submitted!', event.report);
    }
  });

  return <div>...</div>;
}
```

### Show Daily Report Modal

```typescript
import { useSetAtom } from 'jotai';
import { dailyReportModalOpenAtom } from '@/atoms/orchestration';

function MyComponent() {
  const setReportModalOpen = useSetAtom(dailyReportModalOpenAtom);

  return (
    <button onClick={() => setReportModalOpen(true)}>
      Generate Daily Report
    </button>
  );
}
```

## Next Steps

Sprint 1 is complete! Sprint 2 will add:

- ✨ **Intelligent Triage**: Claude API scoring with extended thinking
- 🤖 **Recommendation Engine**: Auto-assign issues to team members
- 📊 **Dashboard**: View triage results and metrics
- 🔄 **GitHub Sync**: Automatically create/assign issues

Stay tuned!

## Troubleshooting

### GitHub OAuth not showing up

**Problem**: Connect button not working
**Solution**:
1. Check `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` are set
2. Restart the app
3. Check browser console for errors (F12)

### "Failed to generate report"

**Problem**: Report generation fails
**Solution**:
1. Verify GitHub token is still valid (hasn't been revoked)
2. Check GitHub API rate limits (60+ remaining)
3. Ensure repository owner/name is correct
4. Check GitHub username/repo are accessible to your account

### Type errors in IDE

**Problem**: IDE shows TypeScript errors
**Solution**:
```bash
# Regenerate types
bun run typecheck:all

# or just check
cd packages/shared && bun run tsc --noEmit
```

## Support

See [GITHUB_INTEGRATION.md](./GITHUB_INTEGRATION.md) for detailed setup and troubleshooting.

Questions? Check:
- GitHub OAuth setup: [GITHUB_INTEGRATION.md](./GITHUB_INTEGRATION.md)
- Architecture: [README.md](../README.md)
- Type errors: Run `bun run typecheck:all`
