# Craft Agent Cloud Worker

Cloudflare Worker that provides cloud sync and remote sandbox execution for Craft Agent workspaces.

## Features

- **Cloud Sync** — Real-time WebSocket sync of sessions, sources, statuses, labels, and skills
- **File Storage** — R2-backed file storage for attachments, downloads, and long responses
- **Remote Sandbox** — Execute Claude Code in isolated Cloudflare containers with GitHub repo access
- **GitHub OAuth** — Authenticate users for private repo access in sandboxes

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers Paid plan (for Durable Objects and Containers)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed
- Node.js 18+

## Quick Start

```bash
# Install dependencies
pnpm install

# Login to Cloudflare
npx wrangler login

# Deploy
npx wrangler deploy
```

## Configuration

### Secrets

Set using `wrangler secret put <NAME>`:

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `API_KEY` | API key for authenticating Electron app requests | Any secure random string |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting credentials | `openssl rand -hex 32` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | See [GitHub OAuth Setup](#github-oauth-setup) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | See [GitHub OAuth Setup](#github-oauth-setup) |
| `ANTHROPIC_API_KEY` | (Optional) Fallback Anthropic API key | From [Anthropic Console](https://console.anthropic.com/) |

```bash
# Set each secret
npx wrangler secret put API_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# Optional: fallback API key if users don't provide their own
npx wrangler secret put ANTHROPIC_API_KEY
```

## GitHub OAuth Setup

The GitHub OAuth App allows users to authenticate and grant access to private repositories for sandbox execution.

### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in the details:

| Field | Value |
|-------|-------|
| **Application name** | `Craft Agent Cloud` (or your preferred name) |
| **Homepage URL** | Your worker URL (e.g., `https://craft-agent-cloud.yourname.workers.dev`) |
| **Authorization callback URL** | `https://craft-agent-cloud.yourname.workers.dev/oauth/github/callback` |

4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy the secret

### 2. Set the Secrets

```bash
# Set the GitHub OAuth credentials
echo "YOUR_CLIENT_ID" | npx wrangler secret put GITHUB_CLIENT_ID
echo "YOUR_CLIENT_SECRET" | npx wrangler secret put GITHUB_CLIENT_SECRET
```

### OAuth Flow

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│ Electron App │     │  Cloud Worker   │     │    GitHub    │
└──────┬───────┘     └────────┬────────┘     └──────┬───────┘
       │                      │                     │
       │ 1. Open browser to   │                     │
       │    /oauth/github     │                     │
       │─────────────────────>│                     │
       │                      │ 2. Redirect to      │
       │                      │    GitHub authorize │
       │                      │────────────────────>│
       │                      │                     │
       │                      │ 3. User authorizes  │
       │                      │<────────────────────│
       │                      │                     │
       │                      │ 4. Exchange code    │
       │                      │    for token        │
       │                      │────────────────────>│
       │                      │                     │
       │                      │ 5. Return token     │
       │                      │<────────────────────│
       │                      │                     │
       │ 6. Redirect to       │                     │
       │    craft-agent://    │                     │
       │<─────────────────────│                     │
       │                      │                     │
```

## Remote Sandbox

The sandbox feature allows executing Claude Code in isolated Cloudflare containers with full repository access.

### Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Electron App  │     │  Cloud Worker    │     │    Sandbox      │
│                 │     │                  │     │   Container     │
│                 │     │                  │     │                 │
│ 1. Create       │────>│ 2. Spawn         │────>│ 3. Git clone    │
│    session      │     │    container     │     │    repository   │
│                 │     │                  │     │                 │
│ 4. WebSocket    │<───>│ 5. Proxy         │<───>│ 6. Claude Code  │
│    messages     │     │    messages      │     │    execution    │
│                 │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### API Key Encryption

For security, Anthropic API keys are encrypted before being sent to the sandbox:

1. **Key Derivation**: Both client and server derive an encryption key from:
   - Workspace API key (known to both)
   - Workspace slug (used as salt)
   - Algorithm: PBKDF2 with SHA-256, 100,000 iterations

2. **Encryption**: Client encrypts the Anthropic API key using AES-256-GCM

3. **Decryption**: Server derives the same key and decrypts

This ensures:
- API keys are never sent in plaintext (even over HTTPS)
- Each user's execution uses their own API key for billing isolation
- Keys cannot be decrypted without knowing the workspace API key

### Sandbox WebSocket Protocol

Connect to: `wss://<worker-url>/workspace/<slug>/sandbox/ws/<sessionId>`

**Execute a task:**
```json
{
  "type": "execute",
  "task": "Add error handling to the login function",
  "anthropicApiKey": "<encrypted-key>"
}
```

**Response:**
```json
{
  "type": "result",
  "success": true,
  "output": "I've added try-catch blocks to...",
  "diff": "diff --git a/src/login.ts..."
}
```

**Ping/Pong (keep-alive):**
```json
{ "type": "ping" }
```
```json
{ "type": "pong" }
```

## API Reference

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `GET` | `/oauth/github` | Initiate GitHub OAuth flow |
| `GET` | `/oauth/github/callback` | GitHub OAuth callback |
| `POST` | `/api/sandbox/check` | Check if repo has GitHub credentials |
| `POST` | `/api/sandbox/create` | Create a new sandbox session |
| `GET` | `/api/sandbox/:slug/:sessionId/status` | Get sandbox session status |
| `DELETE` | `/api/sandbox/:slug/:sessionId` | Terminate sandbox session |
| `POST` | `/api/sandbox/:slug/:sessionId/heartbeat` | Keep session alive |

### WebSocket Endpoints

| Path | Description |
|------|-------------|
| `/workspace/:slug` | Real-time sync for workspace data |
| `/workspace/:slug/sandbox/ws/:sessionId` | Sandbox command execution |

### File Storage Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `PUT` | `/files/:workspace/:session/:type/:filename` | Upload file |
| `GET` | `/files/:workspace/:session/:type/:filename` | Download file |
| `POST` | `/files/:workspace/:session/:type/:filename/sign` | Generate signed URL |
| `DELETE` | `/files/:workspace/:session/:type/:filename` | Delete file |
| `GET` | `/files/:workspace/:session/:type` | List files |
| `DELETE` | `/files/:workspace/:session` | Delete all session files |

## Deployment

### First-time Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Login to Cloudflare
npx wrangler login

# 3. Create R2 bucket (if not exists)
npx wrangler r2 bucket create craft-agent-files-prod

# 4. Generate and set secrets
openssl rand -hex 32  # Copy this for ENCRYPTION_KEY

npx wrangler secret put API_KEY
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET

# 5. Deploy
npx wrangler deploy
```

### Updating

```bash
# Just deploy - secrets persist across deployments
npx wrangler deploy
```

### Local Development

```bash
# Start local dev server
npx wrangler dev

# Note: Durable Objects and Containers require deployment to test fully
```

## Troubleshooting

### "No GitHub credentials for this repo"

The user needs to authenticate via GitHub OAuth for the repository. Trigger the OAuth flow by calling `/api/sandbox/check` which returns an `authUrl` if authentication is needed.

### "Failed to decrypt anthropicApiKey"

The client is sending an incorrectly encrypted API key. Ensure:
1. The workspace API key matches between client and server
2. The workspace slug is correct
3. The encryption uses the same algorithm (PBKDF2 + AES-256-GCM)

### Sandbox session expires

Sessions expire after 30 minutes of inactivity. Send periodic heartbeats or create a new session.

### Container build fails

Ensure Docker is running locally (wrangler builds containers locally before pushing). Check the Dockerfile syntax.

## License

MIT
