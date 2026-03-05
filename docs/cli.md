# craft-cli — CLI Reference

Terminal client for Craft Agent server. Connects over WebSocket (`ws://` or `wss://`) to a running headless server.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed
- A running Craft Agent headless server (see `packages/server/`)
- Server URL and authentication token

## Connection Options

| Flag | Env var | Default | Description |
|------|---------|---------|-------------|
| `--url <ws[s]://...>` | `CRAFT_SERVER_URL` | — | Server WebSocket URL |
| `--token <secret>` | `CRAFT_SERVER_TOKEN` | — | Authentication token |
| `--workspace <id>` | — | auto-detect | Workspace ID |
| `--timeout <ms>` | — | `10000` | Request timeout |
| `--tls-ca <path>` | `CRAFT_TLS_CA` | — | Custom CA cert for self-signed TLS |
| `--json` | — | `false` | Raw JSON output for scripting |
| `--send-timeout <ms>` | — | `300000` | Timeout for `send` command (5 min) |

Flags take precedence over environment variables. If `--workspace` is omitted, the CLI auto-detects the first available workspace.

## Commands

### Info & Health

```bash
craft-cli ping              # Verify connectivity (clientId + latency)
craft-cli health            # Check credential store health
craft-cli versions          # Show server runtime versions
```

### Resource Listing

```bash
craft-cli workspaces        # List all workspaces
craft-cli sessions          # List sessions in workspace
craft-cli connections       # List LLM connections
craft-cli sources           # List configured sources
```

### Session Operations

```bash
craft-cli session create [--name <n>] [--mode <m>]  # Create session
craft-cli session messages <id>                       # Print message history
craft-cli session delete <id>                         # Delete session
craft-cli cancel <id>                                 # Cancel processing
```

### Send Message (Streaming)

```bash
# Send a message and stream the AI response in real time
craft-cli send <session-id> <message>

# Pipe text from stdin
echo "Summarize this file" | craft-cli send <session-id>

# Read from stdin explicitly
cat document.txt | craft-cli send <session-id> --stdin
```

The `send` command subscribes to session events and streams them to stdout:
- `text_delta` — text streamed inline
- `tool_start` — `[tool: name]` marker
- `tool_result` — tool output (truncated to 200 chars)
- `error` — printed to stderr, exit code 1
- `complete` — exit code 0
- `interrupted` — exit code 130

### Power User

```bash
# Raw RPC call — send any channel with JSON args
craft-cli invoke <channel> [json-args...]

# Subscribe to push events (Ctrl+C to stop)
craft-cli listen <channel>
```

Examples:
```bash
craft-cli invoke system:homeDir
craft-cli invoke sessions:get '"workspace-123"'
craft-cli listen session:event
```

### Validate Server

```bash
craft-cli --validate-server
```

Runs a 21-step integration test covering the full server lifecycle including source and skill creation:

1. Connect + handshake
2. `credentials:healthCheck`
3. `system:versions`
4. `system:homeDir`
5. `workspaces:get`
6. `sessions:get`
7. `LLM_Connection:list`
8. `sources:get`
9. `sessions:create` (temporary `__cli-validate-*` session)
10. `sessions:getMessages`
11. Send message + stream (text response)
12. Send message + tool use (Bash tool)
13. `sources:create` (temporary Cat Facts API source)
14. Send + source mention (uses the created source)
15. Send + skill create (writes SKILL.md via Bash)
16. `skills:get` (verify skill appears)
17. Send + skill mention (invokes the created skill)
18. `skills:delete` (cleanup)
19. `sources:delete` (cleanup)
20. `sessions:delete` (cleanup)
21. Disconnect

**Note:** This test mutates workspace state — it creates and deletes a temporary session, source, and skill. All resources are cleaned up on completion. Continues on failure and reports a summary. Use `--json` for machine-readable output.

## Scripting Patterns

```bash
# Get workspace IDs
WORKSPACES=$(craft-cli --json workspaces | jq -r '.[].id')

# Count sessions per workspace
for ws in $WORKSPACES; do
  COUNT=$(craft-cli --json --workspace "$ws" sessions | jq length)
  echo "$ws: $COUNT sessions"
done

# Create a session and capture its ID
SESSION_ID=$(craft-cli --json session create --name "CI Run" | jq -r '.id')

# Send a message and wait for completion
craft-cli send "$SESSION_ID" "Run the test suite and report results"

# Clean up
craft-cli session delete "$SESSION_ID"
```

## TLS / wss://

For remote servers with TLS:

```bash
# Trusted certificate (Let's Encrypt, etc.)
craft-cli --url wss://server.example.com:9100 ping

# Self-signed certificate
craft-cli --url wss://server.example.com:9100 --tls-ca /path/to/ca.pem ping
```

The `--tls-ca` flag sets `NODE_EXTRA_CA_CERTS` before connecting. You can also set `CRAFT_TLS_CA` in your environment.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Connection timeout` | Server not running or unreachable | Check server is started, verify URL |
| `AUTH_FAILED` | Wrong token | Check `CRAFT_SERVER_TOKEN` matches server |
| `PROTOCOL_VERSION_UNSUPPORTED` | Version mismatch | Update CLI and server to same version |
| `WebSocket connection error` | Network issue or TLS problem | For self-signed certs, use `--tls-ca` |
| `No workspace available` | Workspace not yet created | Create one via desktop app or API |
