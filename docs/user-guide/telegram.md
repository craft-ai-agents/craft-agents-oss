# Telegram Integration Guide

Vesper provides comprehensive Telegram bot integration, allowing you to interact with your AI agents directly through Telegram. This guide covers setup, features, and best practices.

## Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow the prompts
3. Choose a name and username for your bot
4. Copy the bot token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Connect to Vesper

1. Open Vesper and navigate to Settings > Integrations > Telegram
2. Paste your bot token in the "Bot Token" field
3. Click "Connect"
4. Your bot is now live and ready to receive messages

### 3. Start Chatting

1. Open Telegram and search for your bot (by username)
2. Send `/start` to begin
3. Send any message to interact with your Vesper agent

## Features

### Multi-Account Support

Run multiple Telegram bot accounts per workspace, each with isolated configurations:

```json
{
  "telegramAccounts": {
    "support-bot": {
      "id": "support-bot",
      "enabled": true,
      "name": "Support Bot",
      "tokenSource": "config",
      "config": {
        "dmPolicy": "open",
        "groupPolicy": "disabled",
        "debounceMs": 1500
      }
    },
    "alerts-bot": {
      "id": "alerts-bot",
      "enabled": true,
      "name": "Alerts Bot",
      "tokenSource": "config",
      "config": {
        "requireMention": true
      }
    }
  }
}
```

**Use Cases:**
- Separate bots for different teams or departments
- Different access control policies per bot
- Specialized bots for different purposes (support, alerts, etc.)

### Access Control

#### Direct Message (DM) Policies

Control who can send direct messages to your bot:

| Policy | Description | Use Case |
|--------|-------------|----------|
| **Disabled** | Block all DMs | Public bots that only work in groups |
| **Pairing** | Require approval with pairing code | Semi-private bot with approval flow |
| **Allowlist** | Only allow specific users | Private bot for team members |
| **Open** | Allow everyone | Public bot for community |

**Pairing Mode Example:**

1. New user sends a message
2. Bot responds with pairing code: `PAIR-2345-ABC123`
3. User shares code with bot owner
4. Owner adds user to allowlist
5. User can now chat with bot

#### Group Policies

Control how your bot behaves in Telegram groups:

| Policy | Description | Use Case |
|--------|-------------|----------|
| **Disabled** | Ignore all group messages | DM-only bot |
| **Allowlist** | Only respond in specific groups/from specific users | Private team groups |
| **Open** | Respond in any group | Public community bot |

**Allowlist Configuration:**

```json
{
  "accessControl": {
    "groupPolicy": "allowlist",
    "allowedChats": ["-1001234567890", "-1009876543210"],
    "allowedUsers": ["123456789", "987654321"]
  }
}
```

### Message Processing

#### Debouncing

Combines rapid sequential messages from the same user within a configurable window (default: 1.5 seconds).

**Example:**
```
User types:
[0.0s] "Can you"
[0.3s] "help me"
[0.8s] "with this bug?"

Bot receives (after 1.5s):
"Can you\n\nhelp me\n\nwith this bug?"
```

**Benefits:**
- Prevents fragmenting context across multiple requests
- More natural conversation flow
- Reduces API calls

**Configuration:**
```json
{
  "config": {
    "debounceMs": 1500  // 1.5 seconds
  }
}
```

**Skip Debouncing For:**
- Commands starting with `/`
- Messages with media attachments

#### Deduplication

Prevents processing duplicate messages caused by network retries or race conditions.

**Features:**
- 10-minute TTL for seen messages
- Max 2000 cached items (automatic pruning)
- Tracks both update IDs and message IDs

#### Echo Tracking

Prevents the bot from processing its own messages in edge cases.

**Features:**
- Tracks sent message IDs for 5 minutes
- Max 100 tracked items (automatic pruning)
- Fast O(1) lookup

#### Mention Gating (Groups)

Filter group messages to only process those that explicitly interact with the bot.

**Processes Messages That:**
- Mention the bot: `@botusername can you help?`
- Reply to a bot message
- Start with a command: `/help`

**Configuration:**
```json
{
  "config": {
    "requireMention": true  // Enable mention gating
  }
}
```

### Retry Logic

Automatic retry for transient failures with exponential backoff and jitter.

**Configuration:**
- **Initial delay:** 1 second
- **Max delay:** 30 seconds
- **Growth factor:** 2x per attempt
- **Jitter:** 25% randomization
- **Max attempts:** 5

**Retry For:**
- 429 (Rate Limited)
- 5xx server errors (500, 503, etc.)
- Network timeouts

**Skip Retry For:**
- 4xx client errors (400, 401, 403, 404)

### Permission Directives

Control agent permissions inline with special command prefixes:

| Directive | Mode | Description |
|-----------|------|-------------|
| `/safe` | Read-only | Blocks all write operations |
| `/ask` | Ask to Edit | Prompts for approval (default) |
| `/allow_all` | Auto | Auto-approves all commands |

**Example:**
```
/allow_all deploy the latest changes to production
```

**How It Works:**
1. Directive is extracted from message
2. Permission mode is applied to session
3. Directive prefix is removed before sending to agent
4. Agent processes message with configured permissions

### Session Continuity

Each (chat + user) pair maintains the same session across messages.

**Benefits:**
- Context is preserved between messages
- Follow-up questions work naturally
- Agent remembers previous conversation

**Session Mapping:**
```
Session ID = SHA256(chatId + userId)
```

### Message Reactions

Visual feedback for message processing status:

| Emoji | Status | Reaction Level |
|-------|--------|----------------|
| 👀 | Acknowledged | `ack` or higher |
| ✅ | Completed | `minimal` or higher |
| ❌ | Error | `minimal` or higher |

**Configuration:**
```json
{
  "config": {
    "reactionLevel": "minimal"  // off, ack, minimal, extensive
  }
}
```

### Typing Indicators

Shows "typing..." in chat while agent is processing.

**Features:**
- Automatic typing indicator on message receipt
- Indicates active processing
- Improves perceived responsiveness

### Rate Limiting

#### Global Rate Limit
- **Limit:** 30 messages per second
- **Implementation:** Message queue with ordered processing

#### Per-Chat Rate Limit
- **Algorithm:** Token bucket
- **Burst:** 5 messages
- **Refill rate:** 0.5 tokens/second (1 message every 2 seconds)

**Benefits:**
- Prevents hitting Telegram API limits
- Ensures fair distribution across chats
- Avoids bot getting banned

### Large Message Handling

Telegram has a 4096 character limit per message. Vesper handles this automatically:

**For Messages > 4096 Characters:**
1. Content is split into chunks (4000 chars each)
2. Each chunk is sent as a separate message
3. Chunks are sent in order with slight delay

**For Very Large Responses:**
- Consider using deep links to open full content in Vesper UI

## Configuration Reference

### Account Configuration

```json
{
  "id": "account-id",
  "enabled": true,
  "name": "Display Name",
  "tokenSource": "config",  // "config" | "env" | "tokenFile"
  "config": {
    "accessControl": {
      "dmPolicy": "allowlist",       // "disabled" | "pairing" | "allowlist" | "open"
      "groupPolicy": "allowlist",    // "disabled" | "allowlist" | "open"
      "allowedUsers": ["123456789"],
      "allowedChats": ["-1001234567890"]
    },
    "debounceMs": 1500,
    "requireMention": false,
    "reactionLevel": "minimal"       // "off" | "ack" | "minimal" | "extensive"
  }
}
```

### Token Sources

| Source | Description | Use Case |
|--------|-------------|----------|
| `config` | Stored in encrypted credentials file | Default (recommended) |
| `env` | Read from `TELEGRAM_BOT_TOKEN` env var | Development/CI |
| `tokenFile` | Read from external file | Future feature |

### Token Resolution Priority

1. Account-specific tokenFile (if `tokenSource: 'tokenFile'`)
2. Account-specific token in credentials (if `tokenSource: 'config'`)
3. Legacy global token (backward compatibility for "default" account)
4. Environment variable `TELEGRAM_BOT_TOKEN` (for "default" account only)

## Best Practices

### Security

1. **Use Allowlists:** For private bots, use `allowlist` policy instead of `open`
2. **Enable Pairing:** For semi-public bots, use `pairing` mode to control access
3. **Limit Group Access:** Specify `allowedChats` to restrict which groups can use the bot
4. **Default to Safe Mode:** Use `/safe` directive by default, `/allow_all` only when needed
5. **Rotate Tokens:** Periodically generate new bot tokens via @BotFather

### Performance

1. **Debounce Configuration:** Adjust `debounceMs` based on user behavior (1500-3000ms recommended)
2. **Mention Gating:** Enable `requireMention` in busy groups to reduce load
3. **Reaction Level:** Use `minimal` or `off` for high-traffic bots
4. **Rate Limiting:** Trust the built-in rate limiting (don't disable it)

### User Experience

1. **Clear Bot Description:** Set a clear description via @BotFather
2. **Commands:** Use `/start` and `/help` commands for onboarding
3. **Error Messages:** User-friendly error messages are shown automatically
4. **Response Time:** Agent responses typically take 5-30 seconds
5. **Typing Indicators:** Keep enabled for better UX

### Multi-Account Usage

1. **Name Accounts Clearly:** Use descriptive names like "support-bot", "alerts-bot"
2. **Separate Concerns:** One bot per purpose (don't overload a single bot)
3. **Different Policies:** Configure access control per bot needs
4. **Consistent Naming:** Use consistent naming conventions across accounts

## Troubleshooting

### Bot Doesn't Respond

**Possible Causes:**
1. Bot is not connected (check Settings > Integrations)
2. Access control is blocking the user (check `allowedUsers`)
3. Group is not in `allowedChats` list
4. Mention gating is enabled but bot wasn't mentioned

**Solutions:**
1. Reconnect bot in Vesper settings
2. Add user ID to `allowedUsers` array
3. Add chat ID to `allowedChats` array
4. Mention bot with `@botusername`

### Duplicate Messages

**Cause:** Network issues or Telegram API retries

**Solution:** Built-in deduplication handles this automatically (no action needed)

### Slow Responses

**Possible Causes:**
1. Complex agent processing (normal)
2. High load on Vesper
3. Network issues

**Solutions:**
1. Break complex requests into smaller parts
2. Check Vesper system resources
3. Verify network connectivity

### Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| "DMs are disabled" | DM policy is `disabled` | Change to `allowlist` or `open` |
| "You are not authorized" | User not in allowlist | Add user to `allowedUsers` |
| "Group messages are disabled" | Group policy is `disabled` | Change to `allowlist` or `open` |
| "Pairing required" | User needs approval | Share pairing code with bot owner |
| "Request timed out" | Agent took >5 minutes | Try simpler query or break into parts |

### Rate Limiting

**Symptoms:**
- Messages delayed
- Bot shows "typing" for extended period
- Some messages not sent

**Causes:**
- Hitting per-chat rate limit (5 messages burst, then 1 per 2 seconds)
- Hitting global rate limit (30 messages/second)
- Telegram API rate limits

**Solutions:**
- Wait for rate limit to reset (automatic)
- Reduce message frequency
- Use multiple accounts for high-volume use cases

## Advanced Topics

### Multi-Account Setup

1. **Create Multiple Bots:** Via @BotFather
2. **Configure in Vesper:** Add to `telegramAccounts` in workspace config
3. **Set Different Policies:** Customize access control per bot
4. **Enable/Disable:** Toggle `enabled` flag per account

### Custom Debounce Windows

Adjust based on user typing speed:

```json
{
  "config": {
    "debounceMs": 3000  // 3 seconds for slower typers
  }
}
```

### Workspace-Specific Configuration

Each workspace can have different bot configurations:

```
~/.vesper/workspaces/{workspace-id}/config.json
```

### Monitoring and Debugging

Check logs at:
```
~/Library/Logs/Vesper/main.log  (macOS)
```

Log levels:
- `[TelegramService]` - Service lifecycle
- `[TelegramRouter]` - Message routing
- `[MessageDeduplicator]` - Duplicate detection
- `[InboundDebouncer]` - Message debouncing

## API Reference

### IPC Handlers

```typescript
// Connect bot
window.api.telegram.connect({
  workspaceId: string,
  botToken: string,
  accountId?: string  // defaults to "default"
})

// Disconnect bot
window.api.telegram.disconnect({
  workspaceId: string,
  accountId?: string
})

// Get connection status
window.api.telegram.getStatus({
  workspaceId: string,
  accountId?: string
})

// Send message
window.api.telegram.sendMessage({
  workspaceId: string,
  chatId: number,
  message: string,
  accountId?: string
})
```

### Configuration Schema

```typescript
interface TelegramAccountConfig {
  id: string
  enabled: boolean
  name: string
  tokenSource: 'config' | 'env' | 'tokenFile'
  config: {
    accessControl?: {
      dmPolicy: 'disabled' | 'pairing' | 'allowlist' | 'open'
      groupPolicy: 'disabled' | 'allowlist' | 'open'
      allowedUsers: string[]
      allowedChats: string[]
    }
    debounceMs?: number
    requireMention?: boolean
    reactionLevel?: 'off' | 'ack' | 'minimal' | 'extensive'
  }
}
```

## Related Documentation

- [Multi-Account Architecture](../../packages/shared/src/telegram/MULTI_ACCOUNT.md)
- [Security Guide](../security.md)
- [Integration Overview](./integrations.md)

---

*Last Updated: 2026-01-26*
