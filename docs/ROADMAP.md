# Vesper Features Roadmap

**Last Updated:** 2026-01-25
**Version:** 1.0

## Product Vision

Vesper is an open-source AI agent platform that enables intuitive multitasking with AI agents through a beautiful, document-centric interface. Built with Agent Native software principles, Vesper is highly customizable and leverages the Claude Agent SDK.

**Core Principles:**
- **Intuitive Multitasking**: Multiple AI sessions with efficient context switching
- **Document-Centric**: Rich content handling, attachments, and previews
- **Agent Native**: First-class support for autonomous agent workflows
- **Highly Customizable**: Skills, themes, sources, and workflows
- **Privacy-First**: Local-first with optional cloud features

---

## Current Features (v1.0)

### Core Platform
- [x] Multi-Session Inbox with status workflow
- [x] Claude Code Experience (streaming, tool visualization)
- [x] Command Palette (CMD+K)
- [x] Permission Modes (Safe/Ask/Auto)
- [x] Session Persistence (JSONL storage)
- [x] Deep Linking (`vesper://` protocol)

### Data Integration
- [x] MCP Server Support (Craft, Linear, GitHub, Notion)
- [x] REST API Sources (Google, Slack, Microsoft)
- [x] Local Filesystem Sources
- [x] Vector Search with QMD

### Agent Features
- [x] Skills System (workspace-level agent instructions)
- [x] Skills Marketplace (skills.sh integration)
- [x] Large Response Summarization
- [x] File Attachments (images, PDFs, Office docs)

### Messaging Integrations
- [x] WhatsApp Integration (QR auth, message routing, permission directives)

### Automation
- [x] Cron Scheduler with session continuation
- [x] Dynamic Status System
- [x] Terminal Resume (cross-platform)

### Collaboration
- [x] Session Sharing (Viewer backends)
- [x] Session Labels (color-coded organization)

---

## Roadmap: Q1 2026

### Priority 1: Messaging Platform Extensions

#### Telegram Integration
**Status:** Planning
**Target:** Q1 2026

Extend messaging platform support with Telegram bot integration.

**Features:**
- Bot token authentication
- Message routing with permission directives
- Session mapping (Telegram chat -> Vesper session)
- Inline keyboard support for approvals
- File/image sharing

**Technical Approach:**
- Use `grammy` or `node-telegram-bot-api` library
- Mirror WhatsApp architecture patterns
- Shared message routing infrastructure

#### Discord Bot Integration
**Status:** Backlog
**Target:** Q2 2026

Add Discord server/DM bot support.

**Features:**
- OAuth2 bot authentication
- Channel and DM message routing
- Slash command integration
- Thread support for session context

---

### Priority 2: Session Enhancements

#### Session Templates
**Status:** Planning
**Target:** Q1 2026

Create reusable session configurations for common workflows.

**Features:**
- Save session as template (prompt, skills, mode, model)
- Template gallery in new session flow
- Workspace and global templates
- Template import/export
- Template marketplace integration

**Use Cases:**
- "Code Review" template with review skill + safe mode
- "Writing Assistant" template with writing skill + allow-all mode
- "Research" template with web search sources

#### Session Branching
**Status:** Backlog
**Target:** Q2 2026

Fork sessions at any point to explore alternative paths.

**Features:**
- Branch from any message
- Visual branch tree
- Compare branch outcomes
- Merge insights back

#### Session Collaboration
**Status:** Research
**Target:** Q3 2026

Multi-user collaboration on sessions.

**Features:**
- Real-time presence
- Comment threads
- Access control
- Conflict resolution

---

### Priority 3: Agent Capabilities

#### Agent Memory
**Status:** Research
**Target:** Q2 2026

Cross-session context persistence for agents.

**Features:**
- Workspace-level memory store
- Key facts and preferences
- User profile learning
- Memory management UI

#### Agent Handoff
**Status:** Backlog
**Target:** Q2 2026

Allow agents to delegate to specialized agents.

**Features:**
- Handoff protocol
- Specialized agent skills
- Context preservation
- Handoff history

#### Multi-Agent Orchestration
**Status:** Research
**Target:** Q3 2026

Coordinate multiple agents on complex tasks.

**Features:**
- Task decomposition
- Agent assignment
- Progress aggregation
- Conflict resolution

---

### Priority 4: Developer Tools

#### Custom MCP Server Builder
**Status:** Backlog
**Target:** Q2 2026

Visual tool to create MCP servers without coding.

**Features:**
- Tool definition wizard
- OAuth configuration
- API endpoint mapping
- Testing sandbox
- One-click deployment

#### Plugin System
**Status:** Research
**Target:** Q3 2026

Third-party extensions for Vesper.

**Features:**
- Plugin API
- UI component slots
- Event hooks
- Plugin marketplace

---

### Priority 5: Analytics & Insights

#### Session Analytics
**Status:** Backlog
**Target:** Q2 2026

Usage statistics and insights.

**Features:**
- Token usage tracking
- Session duration metrics
- Tool usage patterns
- Cost estimation

#### Agent Performance Dashboard
**Status:** Research
**Target:** Q3 2026

Monitor and optimize agent performance.

**Features:**
- Success rate tracking
- Error analysis
- Performance benchmarks
- Optimization suggestions

---

## Implementation Priorities

### Q1 2026 (Current)
1. **Telegram Integration** - Expand messaging platform support
2. **Session Templates** - Improve workflow efficiency

### Q2 2026
3. Agent Memory - Enable cross-session learning
4. Session Branching - Explore alternative paths
5. Custom MCP Server Builder - Empower developers
6. Session Analytics - Understand usage patterns

### Q3 2026
7. Multi-Agent Orchestration - Complex task handling
8. Session Collaboration - Team features
9. Plugin System - Extensibility

---

## Technical Debt & Improvements

### Performance
- [ ] Incremental message persistence
- [ ] Message pagination for large sessions
- [ ] Compressed session storage

### Reliability
- [ ] Automatic session backup
- [ ] Crash recovery improvements
- [ ] Offline mode enhancements

### Security
- [ ] End-to-end encryption for shared sessions
- [ ] Audit logging
- [ ] Fine-grained permission controls

---

## Contributing

We welcome community contributions to the roadmap. Please:
1. Open a GitHub issue for feature requests
2. Join discussions on existing issues
3. Submit PRs for approved features

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

---

## Changelog

### 2026-01-25
- Initial roadmap document created
- Defined Q1-Q3 2026 priorities
- Established feature categories

---

*Maintained by the Vesper team at Ather Labs*
