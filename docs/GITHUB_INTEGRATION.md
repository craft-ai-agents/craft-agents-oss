# GitHub Integration Setup Guide

This document explains how to set up GitHub OAuth for the daily report feature in Vesper.

## Overview

Vesper's GitHub integration allows you to:
- Generate daily reports from GitHub issues and pull requests
- Auto-detect repository activity
- Track team members
- Connect to any GitHub repository (public or private)

## Prerequisites

- A GitHub account
- Administrator access to create an OAuth App (or organization admin)
- A GitHub repository you want to monitor

## Step 1: Create a GitHub OAuth App

1. Go to **GitHub Settings** > **Developer settings** > **[OAuth Apps](https://github.com/settings/developers)**
   - Or visit: https://github.com/settings/developers

2. Click **New OAuth App**

3. Fill in the application details:
   - **Application name**: `Vesper` (or any name you prefer)
   - **Homepage URL**: `http://localhost` (for development)
   - **Application description**: "Daily engineering report generator"
   - **Authorization callback URL**: `http://localhost:9914/oauth/callback`

4. Click **Register application**

5. You'll see your:
   - **Client ID** - Copy this
   - **Client Secret** - Click to reveal and copy this

⚠️ **Important**: Never share your Client Secret publicly!

## Step 2: Configure OAuth Credentials

You have two options for configuring your GitHub OAuth credentials:

### Option A: Settings UI (Recommended)

The easiest way to configure GitHub OAuth is through the Settings UI:

1. Open Vesper application
2. Go to **Settings** > **Credentials**
3. Find the **GitHub OAuth** section
4. Enter your **Client ID** and **Client Secret** from Step 1
5. Click **Save**

This method stores credentials securely in `~/.vesper/credentials.enc` and does not require a restart.

### Option B: Environment Variables

Alternatively, you can configure credentials via environment variables:

1. Open `.env` file in the project root (create if it doesn't exist):

```bash
# .env
GITHUB_OAUTH_CLIENT_ID=your-client-id-from-step-1
GITHUB_OAUTH_CLIENT_SECRET=your-client-secret-from-step-1
```

2. Or copy from the example file:

```bash
cp .env.example .env
# Edit .env and replace placeholder values
```

> **Note**: Environment variables require an application restart to take effect. The Settings UI method (Option A) is recommended as it takes effect immediately.

## Step 3: Restart the Application (Only for Option B)

If you configured credentials via environment variables (Option B), restart the application:

```bash
# Kill the existing process and restart
bun run electron:dev    # or electron:start

# The app will pick up new environment variables
```

> **Tip**: If you used Option A (Settings UI), skip this step - your credentials are already active.

## Step 4: Connect Your Repository

1. Open Vesper application
2. Go to **Workspace Settings** > **GitHub Integration**
3. Click **Connect**
4. Authorize Vesper in GitHub (browser popup)
5. Return to settings and configure:
   - **Repository Owner**: Your GitHub username or organization
   - **Repository Name**: The repository name
   - **Look Back (Days)**: How many days of history to analyze (1-30)

## Scopes Requested

Vesper requests these GitHub permissions:
- `repo` - Access to repository data (required for reading issues and PRs)
- `read:org` - Read organization membership
- `read:user` - Read user profile data

### What Vesper Can Access

Vesper can:
- ✅ Read public and private repository issues
- ✅ Read pull requests
- ✅ See team members
- ✅ Access repository activity

Vesper **cannot**:
- ❌ Modify issues or PRs
- ❌ Create new issues
- ❌ Push code
- ❌ Delete repositories
- ❌ Change settings

## For Production/Team Usage

### Development OAuth App

If you're just testing locally, use the setup above.

### Production OAuth App

For production deployments with a real domain:

1. Go to **GitHub Settings** > **Developer settings** > **OAuth Apps**
2. Click **New OAuth App**
3. Use your actual domain name:
   - **Homepage URL**: `https://yourdomain.com`
   - **Authorization callback URL**: `https://yourdomain.com/oauth/callback`

### For Multiple Environments

Create separate OAuth apps for each environment:
- **Development**: `localhost:9914`
- **Staging**: `staging.yourdomain.com`
- **Production**: `yourdomain.com`

Use environment-specific `.env` files or pass variables at runtime.

## Troubleshooting

### "GitHub OAuth not configured"

**Problem**: Error when trying to connect GitHub
**Solution**:
1. Verify credentials are configured via **Settings > Credentials** or environment variables
2. If using environment variables, ensure you restarted the application
3. Confirm values match your OAuth App on GitHub
4. Try entering credentials directly in **Settings > Credentials** for immediate effect

### "Invalid redirect URI"

**Problem**: Callback fails during OAuth flow
**Solution**:
1. Make sure your OAuth app's callback URL is exactly: `http://localhost:9914/oauth/callback`
2. If running on a different port, update both the app and the OAuth app settings

### "Rate limit exceeded"

**Problem**: Getting rate limit errors when generating reports
**Solution**:
1. GitHub allows 60 requests per hour for unauthenticated requests
2. We cache API responses for 1 hour, so rate limiting is rare
3. Wait 1 hour before trying again
4. Consider using a GitHub Personal Access Token for higher limits (16,000/hour)

### "Repository not found"

**Problem**: Owner/repo not found or no access
**Solution**:
1. Verify repository is public OR you have access (private)
2. Check spelling of repository owner and name
3. For organization repos, verify you have access to that org

## Revoking Access

To remove GitHub access:

1. **In GitHub**: Settings > Apps and integrations > Authorized OAuth Apps > Revoke next to Vesper
2. **In Vesper**: Workspace Settings > GitHub Integration > Disconnect

## Security Notes

- Your GitHub token is stored encrypted in `~/.vesper/credentials.enc`
- Never commit `.env` files with real credentials
- Regularly audit GitHub's authorized apps
- Use separate OAuth apps for development vs production
- Consider using GitHub Personal Access Tokens instead for added security

## For Teams

### Using the Same OAuth App

If you want to share an OAuth app across your team:

1. Create the OAuth app in a shared GitHub organization account
2. Distribute `GITHUB_OAUTH_CLIENT_ID` and `GITHUB_OAUTH_CLIENT_SECRET` securely (not in git)
3. Each team member adds these to their `.env`

### Monitoring Access

Monitor who has authorized the app:
1. Go to GitHub > Settings > Applications
2. Click **Authorized OAuth Apps**
3. View when each team member last authorized Vesper

## API Rate Limits

Vesper is designed to handle GitHub's rate limits:

| Type | Limit | Vesper Strategy |
|------|-------|---|
| Unauthenticated | 60/hour | Uses OAuth token (higher limit) |
| Authenticated | 5,000/hour | Caches responses for 1 hour |
| Search | 30/minute | Doesn't use search APIs |

For most teams, rate limits aren't a concern since we cache aggressively.

## Next Steps

- Configure your repository in Settings
- Generate your first daily report
- Customize look-back period (days of history)
- Set team capacity for future triage features

## Support

Having issues? Check:
1. Environment variables are correctly set
2. GitHub OAuth app configuration matches callback URL
3. Application was restarted after env changes
4. Your GitHub token hasn't been revoked
