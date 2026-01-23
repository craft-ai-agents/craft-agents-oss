# Session Sharing - User Guide

**Last Updated:** 2026-01-23

This guide explains how to share Vespr chat sessions with different viewer backends, giving you full control over where and how your conversations are hosted.

---

## Overview

### What is Session Sharing?

Session sharing allows you to generate a public URL for any Vespr conversation, making it easy to share your AI interactions with teammates, clients, or the community. When you share a session, Vespr creates a read-only viewer that displays the full conversation history.

### Why Use Different Viewer Backends?

Vespr supports multiple viewer backends to give you flexibility and control:

- **Craft Hosted (Default)** - Zero configuration, instant sharing via agents.craft.do
- **Self-Hosted** - Run your own viewer instance for complete data ownership
- **Static Export** - Generate HTML files and host them anywhere (S3, Netlify, GitHub Pages)
- **Local Viewer** - Share on your local network without internet access

Choose the backend that best fits your privacy requirements, infrastructure, and workflow.

### Privacy and Security Considerations

**Important:** When you share a session, the entire conversation history becomes publicly accessible via the generated URL. Before sharing:

- **Review the content** - Ensure no sensitive information (API keys, passwords, private data) is included
- **Consider the backend** - Craft Hosted uploads to a third-party service; Static Export gives you full control
- **Revoke when done** - Use the revoke feature to remove shared sessions you no longer want public
- **Workspace isolation** - Each workspace can use a different viewer backend for different security requirements

---

## Craft Hosted (Default)

### How It Works

The Craft Hosted viewer uploads your session to `https://agents.craft.do`, a service provided by the Claude Agent SDK team. This is the fastest and easiest way to share sessions with zero configuration.

**Technical details:**
- Session data is sent via HTTPS POST to `https://agents.craft.do/s/api`
- The service returns a unique URL like `https://agents.craft.do/s/abc123xyz`
- Sessions remain accessible indefinitely unless revoked
- File size limit: ~10MB per session

### Zero Configuration Required

Craft Hosted works out of the box. Simply:

1. Right-click any session in the session list
2. Select "Share to Viewer"
3. Copy the generated URL and share it

No setup, no configuration files, no API keys needed.

### Custom URL Option

If you're using a self-hosted instance of the Craft viewer that's compatible with the agents.craft.do API, you can point Vespr to your instance:

1. Open **Settings → Sharing**
2. Select **"Craft Hosted (Default)"**
3. Enter your custom URL in the **"Custom Craft URL"** field:
   ```
   https://your-viewer.example.com
   ```
4. Click **"Test Connection"** to verify
5. Click **"Save Settings"**

**Requirements for custom Craft URL:**
- Must support the same REST API as agents.craft.do
- Endpoints: `POST /s/api`, `PUT /s/api/{id}`, `DELETE /s/api/{id}`
- Must accept JSON payloads with StoredSession format

---

## Static Export

### How It Works

Static Export generates self-contained HTML files for each shared session. These files can be:

- Opened directly in a browser (`file:///path/to/session.html`)
- Uploaded to any static file host (AWS S3, Cloudflare R2, Netlify, GitHub Pages, etc.)
- Served from your own web server
- Stored in cloud storage with public access

**Benefits:**
- ✅ **Full data ownership** - Files stored locally
- ✅ **No vendor lock-in** - Works with any static host
- ✅ **Offline capable** - Generate without internet
- ✅ **Portable** - Standard HTML, no dependencies
- ✅ **Privacy-first** - You control where files are uploaded

**Limitations:**
- ❌ **Manual upload** - Requires configuring upload command
- ❌ **No real-time updates** - Static snapshot at time of share
- ❌ **No analytics** - Can't track views or access

### Configuring Export Path

1. Open **Settings → Sharing**
2. Select **"Static Export"**
3. Set **"Export Path"** to your desired directory:
   ```
   ~/vespr-shares
   ```
   Or use an absolute path:
   ```
   /Users/yourname/Documents/shared-sessions
   ```
4. Click **"Save Settings"**

When you share a session, Vespr will generate an HTML file at:
```
~/vespr-shares/{session-id}.html
```

### Upload Command Examples

To automatically upload exported files to a remote host, configure the **"Upload Command"** field. This command runs after each export in the export directory.

#### AWS S3

```bash
aws s3 sync . s3://my-bucket/shares --delete --acl public-read
```

**Setup:**
1. Install AWS CLI: `brew install awscli`
2. Configure credentials: `aws configure`
3. Create S3 bucket with public read access
4. Set bucket URL in settings (optional): `https://my-bucket.s3.amazonaws.com/shares`

**Recommended bucket policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/shares/*"
    }
  ]
}
```

#### Netlify

```bash
netlify deploy --dir=. --prod --site=my-vespr-shares
```

**Setup:**
1. Install Netlify CLI: `npm install -g netlify-cli`
2. Login: `netlify login`
3. Link site: `netlify link --name=my-vespr-shares`
4. Set custom domain in Netlify dashboard (optional)

#### Cloudflare R2

```bash
rclone sync . r2:my-bucket/shares --exclude ".*"
```

**Setup:**
1. Install rclone: `brew install rclone`
2. Configure R2 remote: `rclone config` → Select "s3" → Enter R2 credentials
3. Enable public access in Cloudflare dashboard
4. Set public bucket URL

#### rsync (Self-Hosted Server)

```bash
rsync -avz --delete . user@server.example.com:/var/www/shares/
```

**Setup:**
1. Set up SSH key authentication: `ssh-copy-id user@server.example.com`
2. Configure web server (nginx, Apache) to serve `/var/www/shares/`
3. Ensure directory permissions allow write access

#### GitHub Pages

```bash
git add . && git commit -m "Update shares" && git push origin gh-pages
```

**Setup:**
1. Initialize git repo in export directory: `cd ~/vespr-shares && git init`
2. Create `gh-pages` branch: `git checkout -b gh-pages`
3. Add remote: `git remote add origin https://github.com/username/vespr-shares.git`
4. Enable GitHub Pages in repo settings
5. Set custom domain (optional)

### Security Considerations for Upload Commands

**Important:** Upload commands run in a shell with full system access. Follow these best practices:

- ✅ **Use credential managers** - Store AWS keys in `~/.aws/credentials`, not in the command
- ✅ **Validate commands** - Test manually before configuring
- ✅ **Restrict permissions** - Use least-privilege IAM policies for cloud uploads
- ✅ **Review before upload** - Check generated HTML before syncing
- ❌ **Never include secrets** - Don't put API keys or passwords in the command string

**Vespr security measures:**
- Commands run in the export directory (sandboxed by `cwd`)
- No shell injection from session IDs (alphanumeric only)
- Failed uploads don't mark session as "shared"

### File Permissions and Access Control

Exported HTML files are world-readable by default. To restrict access:

#### Option 1: Server-Side Authentication

Configure your web server to require authentication:

**nginx example:**
```nginx
location /shares {
    auth_basic "Vespr Shares";
    auth_basic_user_file /etc/nginx/.htpasswd;
    root /var/www;
}
```

#### Option 2: Pre-Signed URLs (S3)

Generate time-limited signed URLs instead of public access:

```bash
# Replace upload command with:
aws s3 sync . s3://my-private-bucket/shares
# Then generate signed URL manually:
aws s3 presign s3://my-private-bucket/shares/{session-id}.html --expires-in 3600
```

#### Option 3: Static Site Password Protection

Use services like Netlify's password protection:
```bash
# In Netlify dashboard:
Site Settings → Access Control → Password Protection
```

---

## Self-Hosted Viewer

### How It Works

Run your own instance of the Craft viewer backend on your infrastructure. This gives you:

- ✅ **Full data control** - Sessions stored on your servers
- ✅ **Custom domain** - `shares.yourcompany.com`
- ✅ **Enterprise compliance** - Meet data residency requirements
- ✅ **API compatibility** - Works with existing share workflow

**Requirements:**
- Server with Docker or Node.js runtime
- Public URL with HTTPS (required for secure sharing)
- Optional: API key authentication for additional security

### Configuration

1. Deploy the viewer backend (see [Self-Hosting Guide](../self-hosting/viewer-setup.md))
2. Open **Settings → Sharing** in Vespr
3. Select **"Self-Hosted Viewer"**
4. Enter your viewer URL:
   ```
   https://shares.yourcompany.com
   ```
5. (Optional) Add API key if your viewer requires authentication
6. Click **"Test Connection"** to verify
7. Click **"Save Settings"**

### Deployment Options

See the [Viewer Self-Hosting Guide](../self-hosting/viewer-setup.md) for detailed deployment instructions including:

- Docker Compose setup
- Kubernetes deployment
- Railway/Render one-click deploy
- Custom domain configuration
- SSL certificate setup

---

## Local Viewer

### How It Works

The Local Viewer runs an HTTP server on your machine (`http://localhost:3456` by default), allowing you to share sessions:

- On your local network (accessible from other devices on same WiFi)
- Without internet connection
- Without uploading to any external service

**Use cases:**
- Demo sessions in meetings on local network
- Offline environments (air-gapped systems)
- Testing share functionality during development

**Limitations:**
- ❌ **Local only** - Not accessible from internet
- ❌ **Ephemeral** - Sessions lost when Vespr closes
- ❌ **Single machine** - Only serves from one device at a time

### Configuration

1. Open **Settings → Sharing**
2. Select **"Local Viewer"**
3. (Optional) Change port from default 3456:
   ```
   Port: 8080
   ```
4. Click **"Save Settings"**

When you share a session, the URL will be:
```
http://localhost:3456/{session-id}
```

To access from other devices on your network, replace `localhost` with your machine's local IP:
```
http://192.168.1.100:3456/{session-id}
```

**Finding your local IP:**
```bash
# macOS/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1

# Windows
ipconfig | findstr "IPv4"
```

---

## Configuration

### Where Settings Are Stored

Viewer configuration is saved in:
```
~/.vespr/config.json
```

**Structure:**
```json
{
  "viewer": {
    "type": "craft-hosted",
    "craftUrl": "https://agents.craft.do"
  }
}
```

### Workspace-Level Overrides

Each workspace can use a different viewer backend. Create:
```
~/.vespr/workspaces/{workspace-id}/viewer-config.json
```

**Example:**
```json
{
  "type": "static-export",
  "exportPath": "~/my-project/shared-sessions",
  "uploadCommand": "netlify deploy --dir=. --prod"
}
```

**Cascading configuration:**
1. Check workspace-level `viewer-config.json`
2. Fall back to app-level `config.json > viewer`
3. Default to Craft Hosted if nothing configured

### How to Configure via Settings UI

1. Open Vespr
2. Click **Settings** icon (gear) in top-right
3. Navigate to **"Sharing"** section
4. Select your preferred viewer type
5. Fill in type-specific fields (URL, path, command, etc.)
6. Click **"Test Connection"** (for Craft/Self-Hosted)
7. Click **"Save Settings"**

Changes take effect immediately for new shares. Existing shared sessions remain on their original backend.

### Manual JSON Editing (Advanced Users)

You can edit `~/.vespr/config.json` directly:

```json
{
  "authType": "api_key",
  "workspaces": [...],
  "activeWorkspaceId": "...",
  "activeSessionId": "...",
  "viewer": {
    "type": "static-export",
    "exportPath": "/Users/yourname/vespr-shares",
    "uploadCommand": "aws s3 sync . s3://my-bucket/shares --delete"
  }
}
```

**Restart Vespr** after manual edits to apply changes.

**Validation:**
- `type` must be: `"craft-hosted"` | `"self-hosted"` | `"static-export"` | `"local-viewer"`
- `exportPath` must be absolute or use `~` prefix
- `uploadCommand` is optional (can be empty string or omitted)
- `localPort` must be between 1024-65535

---

## Troubleshooting

### Connection Test Failures

**Symptom:** "Test Connection" button shows ✗ Connection failed

**Craft Hosted / Self-Hosted:**
1. Verify URL is correct and includes `https://`
2. Check if server is reachable: `curl https://agents.craft.do/health`
3. Ensure no corporate firewall blocking the domain
4. Try disabling VPN temporarily
5. Check Vespr logs: `~/Library/Logs/Vespr/main.log`

**Static Export:**
1. Verify export path exists and is writable: `ls -la ~/vespr-shares`
2. Create directory if missing: `mkdir -p ~/vespr-shares`
3. Check disk space: `df -h ~`

**Local Viewer:**
1. Check if port is already in use: `lsof -i :3456`
2. Try a different port (e.g., 8080)
3. Ensure firewall allows local connections

### Upload Command Errors

**Symptom:** Share succeeds but upload fails

**Debugging steps:**
1. Test command manually in export directory:
   ```bash
   cd ~/vespr-shares
   # Run your upload command here
   aws s3 sync . s3://my-bucket/shares
   ```
2. Check command output in Vespr logs: `~/Library/Logs/Vespr/main.log`
3. Verify credentials are configured:
   - AWS: `aws configure list`
   - Netlify: `netlify status`
   - rsync: `ssh user@server.example.com "echo ok"`

**Common errors:**

| Error | Cause | Solution |
|-------|-------|----------|
| `aws: command not found` | AWS CLI not installed | `brew install awscli` |
| `Permission denied` | Invalid credentials | `aws configure` |
| `netlify: command not found` | Netlify CLI not installed | `npm install -g netlify-cli` |
| `Connection refused` | Server unreachable | Check SSH keys, firewall |
| `Bucket does not exist` | Wrong bucket name | Verify in AWS console |

### File Permission Issues

**Symptom:** Can't write to export directory

```bash
# Fix permissions
chmod 755 ~/vespr-shares

# Fix ownership
chown -R $(whoami) ~/vespr-shares
```

**Symptom:** Uploaded files not publicly accessible

**S3:**
```bash
# Set ACL on existing files
aws s3 sync s3://my-bucket/shares s3://my-bucket/shares --acl public-read
```

**nginx/Apache:**
```bash
# Fix web server permissions
sudo chown -R www-data:www-data /var/www/shares
sudo chmod -R 755 /var/www/shares
```

### Network Errors

**Symptom:** Share fails with "Network error"

**Solutions:**
1. Check internet connection: `ping agents.craft.do`
2. Verify DNS resolution: `nslookup agents.craft.do`
3. Test HTTPS: `curl -v https://agents.craft.do/health`
4. Check system proxy settings
5. Temporarily disable VPN/proxy
6. Try different network (mobile hotspot)

**Symptom:** "Session file is too large to share"

**Cause:** Session exceeds 10MB limit (Craft Hosted / Self-Hosted)

**Solutions:**
1. Use Static Export instead (no size limit)
2. Archive and create new session
3. Remove large attachments from session history
4. Self-host viewer with higher size limits

### Shared URL Not Loading

**Symptom:** URL returns 404 or blank page

**Craft Hosted / Self-Hosted:**
1. Verify `sharedId` matches URL: Check session metadata in `~/.vespr/workspaces/{id}/sessions/{id}/metadata.json`
2. Check if session was revoked
3. Try re-sharing the session

**Static Export:**
1. Verify file exists: `ls ~/vespr-shares/{session-id}.html`
2. Check upload command succeeded (no errors in logs)
3. Verify bucket/server is publicly accessible
4. Test direct file access: `curl https://your-bucket.s3.amazonaws.com/shares/{id}.html`

**Local Viewer:**
1. Ensure Vespr is still running (server stops when app closes)
2. Verify correct local IP if accessing from another device
3. Check firewall isn't blocking port: `sudo lsof -i :3456`

### Switching Backends

**Symptom:** Changed backend but shares still go to old one

**Solution:**
1. Restart Vespr after config changes
2. Verify `~/.vespr/config.json` was updated
3. Check for workspace-level override: `~/.vespr/workspaces/{id}/viewer-config.json`

**Existing shares:**
- Old shares remain on original backend
- New shares use new backend
- To migrate: Revoke old share → Re-share with new backend

---

## Best Practices

### When to Use Each Backend

| Use Case | Recommended Backend | Why |
|----------|---------------------|-----|
| Quick one-off share | Craft Hosted | Zero setup, instant URL |
| Sharing with team | Self-Hosted | Custom domain, branding |
| Public showcase | Static Export + S3 | Fast CDN, low cost |
| Client demos | Self-Hosted | Professional domain |
| Privacy-sensitive | Static Export (no upload) | Keep files local |
| Air-gapped systems | Local Viewer | No internet required |
| Enterprise compliance | Self-Hosted | Data residency control |

### Security Checklist

Before sharing any session:

- [ ] Review entire conversation for sensitive data
- [ ] Remove API keys, passwords, credentials
- [ ] Redact customer information, PII
- [ ] Check attached files don't contain secrets
- [ ] Verify viewer backend matches privacy requirements
- [ ] Set expiration reminder (revoke later)
- [ ] Document what was shared (for audit trail)

### Performance Tips

**Static Export:**
- Enable gzip compression on web server
- Use CDN (CloudFront, Cloudflare) for global distribution
- Minify HTML if sharing many large sessions

**Self-Hosted:**
- Use HTTP/2 for faster loads
- Enable caching headers
- Consider Redis for session metadata

**Local Viewer:**
- Use localhost URL when accessing from same machine (faster)
- Close unused shares to free memory

---

## FAQ

**Q: Can I use multiple backends at once?**

A: Not per session, but you can configure different backends per workspace. Each shared session uses one backend.

**Q: What happens to existing shares when I switch backends?**

A: Old shares remain on their original backend. Only new shares use the new backend. To migrate, revoke and re-share.

**Q: Are shared sessions encrypted?**

A: HTTPS encrypts transit (Craft/Self-Hosted). Static files are unencrypted HTML unless you add server-side encryption. Session data is NOT end-to-end encrypted.

**Q: Can I password-protect shared sessions?**

A: Not natively. Use Static Export with a password-protected web host (Netlify, nginx auth) or self-host with custom auth layer.

**Q: How long do shares last?**

A: Indefinitely until revoked (all backends) or until you delete the HTML file (Static Export) or stop Vespr (Local Viewer).

**Q: Can I share a subset of messages, not the whole session?**

A: Not currently. Shares include full conversation history. Feature request: [GitHub Issue #XXX](link).

**Q: Does sharing affect my API usage/costs?**

A: No. Sharing only uploads stored session data, doesn't call Claude API.

---

## Related Documentation

- [Self-Hosting Guide](../self-hosting/viewer-setup.md) - Deploy your own viewer backend
- [Session Management](./sessions.md) - Working with sessions
- [Privacy & Security](../security/privacy.md) - Data handling best practices
- [Configuration Reference](../reference/config.md) - Complete config schema

---

**Need help?** Open an issue on [GitHub](https://github.com/atherslabs/vespr/issues) or join our [Discord](https://discord.gg/vespr).
