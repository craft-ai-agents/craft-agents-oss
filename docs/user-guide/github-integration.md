# GitHub Integration

Vesper provides seamless GitHub integration for orchestration features like daily reports, repository insights, and automated workflows. This guide walks you through setting up and using the GitHub OAuth integration.

## Overview

The GitHub integration enables:
- Automated daily repository reports
- Access to repository data for AI-powered insights
- Secure OAuth 2.0 authentication with PKCE
- Multi-workspace GitHub account connections

## Setup Process

Setting up GitHub integration requires two steps:

1. **Configure OAuth App Credentials** - One-time setup of your GitHub OAuth App
2. **Connect Your GitHub Account** - Per-workspace account authentication

### Step 1: Configure OAuth App Credentials

These credentials allow Vesper to authenticate with GitHub on your behalf. You only need to do this once.

#### Creating a GitHub OAuth App

1. Navigate to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"** (or **"Register a new application"**)
3. Fill in the application details:
   - **Application name**: `Vesper Local` (or any name you prefer)
   - **Homepage URL**: `http://localhost`
   - **Authorization callback URL**: `vesper://auth/github/callback`
4. Click **"Register application"**
5. Copy the **Client ID** shown on the page
6. Click **"Generate a new client secret"** and copy the **Client Secret**

#### Adding Credentials to Vesper

1. Open **Settings** in Vesper
2. Navigate to **GitHub Integration**
3. Locate **Step 1: Configure OAuth App Credentials**
4. Click **"How to setup your OAuth App"** if you need detailed instructions
5. Paste your **Client ID** and **Client Secret** into the form
6. Click **"Test Connection"** to verify your credentials
7. If the test succeeds, click **"Save Credentials"**

Your credentials are encrypted with AES-256-GCM and stored securely on your device.

### Step 2: Connect Your GitHub Account

After configuring OAuth credentials, you can connect your GitHub account to any workspace.

1. In **Settings > GitHub Integration**, locate **Step 2: Connect GitHub Account**
2. Click **"Connect GitHub Account"**
3. A browser window will open with GitHub's authorization page
4. Review the permissions requested:
   - `repo` - Full control of repositories
   - `read:org` - Read organization membership
   - `read:user` - Read user profile data
5. Click **"Authorize"** on GitHub
6. You'll be redirected back to Vesper automatically
7. Your connection status will update to show your GitHub username

## Using GitHub Integration

### Daily Repository Reports

Once connected, you can configure a default repository for daily reports:

1. In **Settings > GitHub Integration**, find **Step 3: Configure Repository**
2. Enter:
   - **Repository Owner**: Your organization or username (e.g., `octocat`)
   - **Repository Name**: The repository name (e.g., `hello-world`)
   - **Look Back (Days)**: How many days of activity to include (default: 1)
3. Save your settings

You can now request daily reports from the AI agent using natural language like:
- "Generate a daily report for the repository"
- "What happened in the repo today?"
- "Show me recent activity"

### Disconnecting

To disconnect your GitHub account:

1. Open **Settings > GitHub Integration**
2. In **Step 2**, click **"Disconnect"**
3. Confirm the disconnection

This removes your access token from Vesper. You can reconnect anytime.

### Clearing OAuth Credentials

If you need to change OAuth Apps or remove credentials entirely:

1. Open **Settings > GitHub Integration**
2. In **Step 1**, click **"Clear"**
3. Confirm the action

Note: Clearing credentials will also disconnect all GitHub accounts using those credentials.

## Security Considerations

### OAuth Flow

Vesper uses GitHub's OAuth 2.0 flow with several security measures:

- **PKCE (Proof Key for Code Exchange)**: Protects against authorization code interception
- **CSRF State Validation**: Prevents cross-site request forgery attacks
- **Local Callback Server**: Uses a temporary local server for secure callback handling
- **Encrypted Storage**: All tokens are encrypted with AES-256-GCM before storage

### Credentials Storage

| Item | Storage Location | Encryption |
|------|------------------|------------|
| OAuth Client ID | `~/.vesper/credentials.enc` | AES-256-GCM |
| OAuth Client Secret | `~/.vesper/credentials.enc` | AES-256-GCM |
| Access Token | `~/.vesper/credentials.enc` | AES-256-GCM |

### Permissions

The GitHub integration requests these scopes:

- `repo`: Required for reading repository data, commits, PRs, issues
- `read:org`: Required for organization membership (needed for private repos in orgs)
- `read:user`: Required for user profile information

You can revoke Vesper's access anytime from [GitHub Settings > Applications](https://github.com/settings/applications).

## Troubleshooting

### "GitHub OAuth not configured"

**Cause**: OAuth App credentials haven't been added to Vesper.

**Solution**: Complete Step 1 in Settings > GitHub Integration. Make sure to save your Client ID and Client Secret.

### "Invalid credentials" during test

**Causes**:
- Client ID or Client Secret was copied incorrectly
- Extra spaces in the credentials
- Using credentials from a different GitHub OAuth App

**Solutions**:
- Double-check your GitHub OAuth App's credentials
- Copy credentials again, ensuring no extra spaces
- Verify the callback URL matches: `vesper://auth/github/callback`

### "OAuth state mismatch - possible CSRF attack"

**Cause**: The OAuth callback received an invalid state parameter.

**Solutions**:
- Close the browser window and try again
- Check your system clock is accurate
- Disable browser extensions that might interfere with redirects

### "Token exchange failed"

**Causes**:
- Network connectivity issues
- GitHub API temporary outage
- Expired authorization code

**Solutions**:
- Check your internet connection
- Wait a few minutes and try again
- Start a fresh OAuth flow

### Test connection works but OAuth fails

**Causes**:
- Callback URL misconfigured in GitHub OAuth App
- Browser blocking the `vesper://` protocol handler

**Solutions**:
- Verify callback URL is exactly: `vesper://auth/github/callback`
- Check your browser allows custom protocol handlers
- Try a different browser

### Rate limit exceeded

**Cause**: Too many test connection attempts in a short time.

**Solution**: Wait 5-10 minutes before testing again. GitHub has rate limits on API requests.

## Advanced Features

### Retry Logic

The OAuth implementation includes automatic retry with exponential backoff:

- **Token Exchange**: Up to 3 attempts with 500ms initial delay
- **User Info Fetch**: Up to 3 attempts with 500ms initial delay
- **Jitter**: Random delay variation to prevent thundering herd

### Error Categorization

Errors are classified for appropriate handling:

- **401/403**: Authentication errors (no retry)
- **429**: Rate limit (user informed, no retry)
- **500+**: Server errors (retried with backoff)
- **Network errors**: Connection failures (retried with backoff)

### Environment Variables (Optional)

For automated setups, you can provide OAuth credentials via environment variables:

```bash
export GITHUB_OAUTH_CLIENT_ID="Ov23li..."
export GITHUB_OAUTH_CLIENT_SECRET="your_secret_here"
```

Credentials in the UI take priority over environment variables.

## API Reference

See [GitHub OAuth API Documentation](../api/github-oauth.md) for technical details.

## Related Documentation

- [Settings Guide](settings.md) - General settings configuration
- [Orchestration Features](orchestration.md) - Using GitHub integration in workflows
- [Security Overview](../developer/security.md) - Vesper's security architecture

## Support

If you encounter issues not covered in this guide:

1. Check the [GitHub Issues](https://github.com/atherslabs/vesper/issues) for similar problems
2. Review your GitHub OAuth App settings
3. Check Vesper logs at `~/Library/Logs/Vesper/`
4. File a bug report with debug logs

---

*Last Updated: 2026-01-26*
