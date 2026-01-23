# WhatsApp Integration

## Overview

Vespr's WhatsApp integration enables AI agents to receive and respond to messages from WhatsApp groups. By connecting your WhatsApp account to Vespr, you can interact with AI agents directly through WhatsApp, making it easier to collaborate with your team and leverage AI assistance in your existing communication channels.

**Key Features:**
- QR code-based authentication for secure connection
- Group message monitoring with @vespr mentions
- Permission-based agent control (safe, ask, allow-all modes)
- Session mapping to organize conversations
- Desktop and in-app notifications for incoming messages
- Real-time response delivery

## Setup & Configuration

### Prerequisites

Before connecting WhatsApp to Vespr:
- Have an active WhatsApp account with a phone number
- Ensure WhatsApp is installed on your mobile device
- Have Vespr desktop app installed and running
- Be part of at least one WhatsApp group where you want to use Vespr

### Connecting WhatsApp

1. **Open Vespr Settings**
   - Navigate to Settings in the Vespr desktop app
   - Find the "WhatsApp Integration" section

2. **Enter Phone Number**
   - Input your WhatsApp phone number (e.g., +1234567890)
   - Click the "Connect" button

3. **Scan QR Code**
   - A modal will appear with a QR code
   - Open WhatsApp on your phone
   - Go to: **Settings → Linked Devices → Link a Device**
   - Scan the QR code displayed in Vespr

4. **Wait for Connection**
   - Once scanned, Vespr will authenticate with WhatsApp
   - You'll see a success notification when connected
   - Your phone number will appear in the "Connected Accounts" list

### Managing Connections

**View Connected Accounts:**
- Go to Settings → WhatsApp Integration
- All connected phone numbers are listed with their connection status

**Disconnect Account:**
- Click the "Disconnect" button next to any connected account
- This will revoke the session and delete all stored credentials (GDPR compliant)

**Multiple Accounts:**
- You can connect multiple WhatsApp accounts to the same workspace
- Each account maintains its own session and credentials

## Usage

### Triggering the Agent

To interact with Vespr through WhatsApp, mention `@vespr` in any group message:

```
@vespr What's the weather in San Francisco?
```

The agent will:
1. Detect the mention
2. Process your request
3. Respond in the same WhatsApp group thread

### Permission Modes

Control how the agent operates by adding a permission directive to your message:

#### Safe Mode (Read-Only)
```
@vespr /safe What files are in this repository?
```
- Blocks all write operations
- Agent can only read and respond
- Safest option for exploratory questions

#### Ask Mode (Default)
```
@vespr /ask Create a new document about project planning
```
- Prompts for approval before executing commands
- Recommended for most use cases
- Balances automation with control

#### Allow-All Mode (Full Automation)
```
@vespr /allow-all Deploy the latest changes to production
```
- **⚠️ Use with extreme caution**
- Auto-approves all commands without confirmation
- Only use for trusted, well-defined tasks
- May be restricted by workspace security settings

**Note:** If you don't specify a permission mode, the agent defaults to `ask` mode.

### Session Mapping

Vespr automatically maps WhatsApp conversations to internal sessions:

- **Group-Based Sessions:** Each WhatsApp group gets its own Vespr session
- **Conversation History:** All messages and responses are logged
- **Context Preservation:** The agent remembers previous messages in the group
- **Cross-Session Memory:** Sessions are isolated to prevent context leakage

### Response Format

Agent responses are formatted for WhatsApp readability:

- **Plain Text Responses:** Simple answers sent as text messages
- **Code Blocks:** Formatted with backticks (```) for readability
- **Lists:** Rendered with bullet points or numbers
- **Error Messages:** Clearly marked with ❌ prefix
- **Long Responses:** Automatically split into multiple messages if needed

## Features

### Desktop Notifications

**Native OS Notifications:**
- Receive desktop notifications when WhatsApp messages arrive
- See sender name, group name, and message preview
- Click notification to focus Vespr window
- Works on macOS and Windows

**Customize Notifications:**
- Control notification preferences through your OS settings
- Vespr respects system-level notification permissions

### In-App Notifications

**Toast Notifications:**
- See in-app toasts when messages are received
- Get notified when agent starts processing
- Confirmation toast when response is sent to WhatsApp
- Dismissible and non-intrusive

**Activity Indicators:**
- WhatsApp icon badge in sidebar shows active processing
- Spinner indicator when agent is actively working
- Badge count displays pending/processing requests

### Message Routing

**Intelligent Message Handling:**
- Only messages with `@vespr` mentions are processed
- Group messages are prioritized over direct messages
- Messages from self are automatically skipped
- Rate limiting prevents spam and abuse

**Permission Security:**
- Security allowlist can restrict who can use elevated permissions
- Maximum permission level can be capped at workspace level
- Rate limiting per sender prevents abuse
- All message processing is logged for audit

### Session Persistence

**Credential Management:**
- WhatsApp sessions stored with AES-256-GCM encryption
- Credentials isolated per workspace
- Automatic session restoration on app restart
- GDPR-compliant credential deletion on disconnect

**Session Expiry:**
- Sessions can expire if not used for extended periods
- Automatic re-authentication prompts when expired
- QR code generation for session renewal

## Troubleshooting

### Connection Issues

**QR Code Not Appearing:**
- Check internet connection on both desktop and mobile
- Restart Vespr desktop app
- Clear browser cache if using web version
- Try a different phone number

**QR Code Won't Scan:**
- Ensure QR code is fully visible and not cut off
- Increase screen brightness on desktop
- Move phone closer to screen
- Try using WhatsApp's camera zoom feature

**Connection Drops:**
- Check if WhatsApp is logged out on mobile device
- Verify Vespr is allowed in firewall settings
- Restart both Vespr and WhatsApp on mobile
- Disconnect and reconnect the account

### Message Processing Issues

**Agent Not Responding:**
- Verify the message includes `@vespr` mention
- Check if the account is still connected in Settings
- Ensure the group has the connected WhatsApp number
- Check Vespr logs for error messages (~/Library/Logs/Vespr/)

**Delayed Responses:**
- WhatsApp may rate-limit message delivery
- Large requests take longer to process
- Check network connection quality
- Review activity indicator for processing status

**Permission Errors:**
- Verify permission mode is appropriate for the task
- Check workspace security settings
- Ensure sender is on security allowlist (if configured)
- Try using a less restrictive permission mode

### Performance Issues

**Slow Message Processing:**
- Complex tasks naturally take longer
- Multiple concurrent requests are queued
- Check system resource usage (CPU, memory)
- Consider breaking large tasks into smaller requests

**High Memory Usage:**
- Long-running sessions accumulate message history
- Disconnect and reconnect to clear session cache
- Restart Vespr if memory usage is excessive
- Check for memory leaks in logs

### Security Concerns

**Unauthorized Access:**
- Immediately disconnect the account in Settings
- Review workspace security allowlist
- Check audit logs for suspicious activity
- Contact support if breach suspected

**Credential Storage:**
- All credentials encrypted with AES-256-GCM
- Stored locally in ~/.vespr/ directory
- Automatically deleted on disconnect
- Never transmitted to third parties

**Rate Limiting Triggered:**
- WhatsApp may ban accounts sending too many messages
- Reduce request frequency
- Use batching for multiple questions
- Wait for previous request to complete before sending new one

## Advanced Configuration

### Security Settings

**Configure Permission Allowlist:**
```json
{
  "whatsapp": {
    "security": {
      "maxPermissionLevel": "ask",
      "allowedPhoneNumbers": ["+1234567890"],
      "rateLimitPerMinute": 10
    }
  }
}
```

**Location:** `~/.vespr/workspaces/{workspace-id}/config.json`

**Options:**
- `maxPermissionLevel`: Maximum permission mode allowed (`safe` or `ask`, never `allow-all`)
- `allowedPhoneNumbers`: Array of phone numbers permitted to use elevated permissions
- `rateLimitPerMinute`: Maximum messages per sender per minute

### Message Queue Configuration

**Configure Queue Settings:**
```json
{
  "whatsapp": {
    "messageQueue": {
      "maxRetries": 3,
      "retryDelay": 1000,
      "maxQueueSize": 100
    }
  }
}
```

**Location:** `~/.vespr/workspaces/{workspace-id}/config.json`

**Options:**
- `maxRetries`: Number of retry attempts for failed messages
- `retryDelay`: Milliseconds to wait between retries
- `maxQueueSize`: Maximum number of queued messages

### Session Configuration

**Configure Session Settings:**
```json
{
  "whatsapp": {
    "sessions": {
      "autoRestore": true,
      "sessionTimeout": 86400000,
      "cleanupInterval": 3600000
    }
  }
}
```

**Location:** `~/.vespr/workspaces/{workspace-id}/config.json`

**Options:**
- `autoRestore`: Automatically restore sessions on app restart
- `sessionTimeout`: Milliseconds before session expires (24 hours default)
- `cleanupInterval`: Milliseconds between cleanup checks (1 hour default)

## Best Practices

### Security Recommendations

1. **Use Ask Mode by Default:** Never use `allow-all` mode unless absolutely necessary
2. **Configure Allowlist:** Restrict elevated permissions to trusted phone numbers
3. **Monitor Activity:** Regularly review Vespr logs for unusual activity
4. **Rotate Sessions:** Disconnect and reconnect periodically to refresh credentials
5. **Limit Exposure:** Only add the WhatsApp account to necessary groups

### Performance Optimization

1. **Batch Requests:** Combine multiple questions into a single message when possible
2. **Use Specific Queries:** Provide clear, concise instructions to reduce processing time
3. **Avoid Concurrent Requests:** Wait for one request to complete before sending another
4. **Clean Up Sessions:** Disconnect unused accounts to free resources
5. **Monitor Queue Size:** Keep the message queue size reasonable

### Usage Guidelines

1. **Clear Communication:** Structure messages clearly with explicit instructions
2. **Include Context:** Provide necessary background information in the message
3. **Specify Constraints:** Mention any limitations or requirements upfront
4. **Use Mentions:** Always include `@vespr` to trigger the agent
5. **Review Responses:** Verify agent responses before acting on them

## Data & Privacy

### Data Storage

**Local Storage:**
- All WhatsApp credentials stored locally in `~/.vespr/` directory
- Message history stored in workspace session files
- No data transmitted to external servers (except Anthropic API)

**Encryption:**
- Credentials encrypted with AES-256-GCM
- Encryption key stored securely in system keychain
- Message content encrypted in transit

### GDPR Compliance

**Data Rights:**
- Disconnect feature permanently deletes all credentials
- Message history can be deleted by removing session files
- No personally identifiable information retained after disconnect

**Data Processing:**
- Messages processed locally on your device
- Agent API calls sent to Anthropic Claude API
- No third-party analytics or tracking

## Support & Resources

### Getting Help

**Documentation:**
- [Vespr Main Documentation](../README.md)
- [Session Management Guide](../architecture-session-management.md)
- [GitHub Integration](../GITHUB_INTEGRATION.md)

**Logs Location:**
- macOS: `~/Library/Logs/Vespr/`
- Windows: `%APPDATA%/Vespr/logs/`
- Linux: `~/.config/Vespr/logs/`

**Configuration:**
- User Data: `~/.vespr/`
- Workspace Config: `~/.vespr/workspaces/{workspace-id}/`
- Credentials: `~/.vespr/credentials.enc`

### Known Limitations

1. **Group Messages Only:** Currently only supports WhatsApp group messages (not direct messages)
2. **Text Only:** Media attachments (images, videos, files) not yet supported
3. **Single Device:** One WhatsApp account per Vespr instance
4. **Rate Limits:** Subject to WhatsApp's rate limiting policies
5. **Session Expiry:** Long periods of inactivity may require re-authentication

### Reporting Issues

If you encounter issues:

1. Check this troubleshooting guide first
2. Review logs for error messages
3. Open an issue on [GitHub](https://github.com/atherslabs/vespr/issues)
4. Include: Vespr version, OS version, error logs, steps to reproduce

---

**Last Updated:** 2026-01-23
**Version:** 1.0.0
**Status:** Production Ready
