# 01_REPO_MAP.md — craft-agents-oss

## What It Does
Craft Agents is an AI agent desktop application (Electron-based) built on the Claude Agent SDK and Pi SDK. It enables multi-session inbox management, MCP server integration, multi-LLM provider support, and skill-based agent customization. It can run as a headless server with a thin desktop client for remote access.

## Tech Stack
- **Runtime**: Bun (JavaScript/TypeScript)
- **UI Framework**: React 18 + Vite
- **Desktop**: Electron 39
- **Agent SDKs**: `@anthropic-ai/claude-agent-sdk`, `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- **MCP**: `@modelcontextprotocol/sdk`
- **Rich Text**: Tiptap (ProseMirror-based editor)
- **Styling**: Tailwind CSS v4
- **Testing**: Bun test + Python unittest (for doc tool smoke tests)
- **Build**: esbuild, electron-builder

## Package/App Structure

### Workspace root
```
package.json          # Bun workspaces root, scripts, deps
bun.lock             # Lockfile
bunfig.toml          # Bun config
tsconfig.json        # Root TypeScript config
```

### Apps (`apps/`)
| App | Purpose |
|-----|---------|
| `electron/` | Main desktop GUI app (primary) |
| `cli/` | Terminal client for headless server |
| `viewer/` | Document viewer |
| `webui/` | Web-based UI (built into server) |
| `marketing/` | Marketing site |

### Packages (`packages/`)
| Package | Purpose |
|---------|---------|
| `core/` | Shared TypeScript types/interfaces |
| `shared/` | Business logic (agent, auth, MCP, config) |
| `ui/` | React component library |
| `server/` | Headless server (RPC over WebSocket) |
| `server-core/` | Server core abstractions |
| `session-tools-core/` | Tool definitions for sessions |
| `session-mcp-server/` | MCP server implementation for sessions |
| `pi-agent-server/` | Pi agent server |
| `messaging-gateway/` | Messaging gateway |
| `messaging-whatsapp-worker/` | WhatsApp worker |

### Top-level docs/scripts
```
docs/cli.md          # CLI reference
scripts/             # Build/release/utility scripts
```

## Build/Lint/Test Commands

| Command | What it does |
|---------|--------------|
| `bun run validate:ci` | Full CI check: typecheck:all + test:shared:all + test:doc-tools + i18n linting |
| `bun run validate:dev` | Dev validation: typecheck:all + shared tests + doc tool tests |
| `bun run typecheck:all` | Full TypeScript check across all packages |
| `bun run test` | Bun test + isolated test files |
| `bun run test:shared:all` | All shared package tests |
| `bun run test:doc-tools` | Python unittest for doc tools (pdf, xlsx, docx, pptx, img, ical, etc.) |
| `bun run lint` | IPC send checks + tool name checks + electron/shared/ui linting |
| `bun run electron:start` | Build and launch Electron app |
| `bun run electron:dev` | Dev mode for Electron |
| `bun run server:start` | Start headless server |
| `bun run server:prod` | Production server with bundled assets |
| `bun run electron:dist:linux/mac/win` | Build distributable Electron app |

## CI/CD

### `validate.yml`
- Triggered on: PR, push to main, manual dispatch
- Runs: `bun run validate:ci`
- Steps: checkout → setup-bun → install-uv → reject-windows-illegal-filenames → install → validate:ci

### `validate-server.yml`
- Triggered on: manual workflow dispatch
- Matrix: ubuntu-latest, macos-latest, windows-latest
- Timeout: 15 minutes
- Runs: `bun run apps/cli/src/index.ts --validate-server` (21-step integration test)

## Risk-Sensitive Areas
- **Agent execution** (`packages/shared/src/agent/`): LLM tool invocation, file system operations, permission modes (safe/ask/allow-all)
- **Auth** (`packages/shared/src/auth/`): Credential management, API key handling
- **MCP integration** (`packages/shared/src/mcp/`): External server connections, stdio-based local MCPs
- **Server RPC** (`packages/server/src/`): WebSocket protocol, token auth, TLS
- **Permission modes**: `safe` (read-only), `ask` (prompts), `allow-all` (auto-approve) — risky changes here could cause unintended file/API operations

## Safe PR Areas
- **Documentation**: README, docs/, CODE_OF_CONDUCT, CONTRIBUTING updates
- **i18n strings**: Locale files, lint-i18n-* scripts
- **CI/CD**: Workflow YAML changes (without altering test logic)
- **UI components** (`packages/ui/src/`): React component additions (with proper type props)
- **Tests**: Adding tests to existing test files in `packages/shared/tests/` or `packages/shared/src/config/__tests__/`
- **Package.json updates**: Adding new dependencies (needs review for security)
- **Scripts**: Utility scripts in `scripts/`

## Key Configuration Files
- `.env.example` — Environment variable template
- `Dockerfile.server` — Server Docker image
- `electron-builder.yml` — Electron build config
- `vite.config.ts` (in apps) — Vite bundler config