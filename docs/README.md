# Vesper Documentation

Welcome to the Vesper documentation. This directory contains comprehensive guides, architecture documentation, and implementation details for the Vesper AI agent platform.

---

## User Guides

End-user documentation for using Vesper features:

- [Task Lists User Guide](user-guide/task-lists.md) - Organize, track, and coordinate work across AI agents
- [Ralph Mode User Guide](ralph-mode-user-guide.md) - Autonomous coding with Ralph Loop

---

## Features

Detailed feature documentation:

- [Session Sharing](features/session-sharing.md) - Share sessions via the viewer service
- [Session Templates](features/session-templates.md) - Create reusable session configurations
- [Scheduler](features/scheduler.md) - Schedule automated tasks and workflows
- [WhatsApp Integration](features/whatsapp-integration.md) - Connect Vesper to WhatsApp for messaging

---

## Architecture

Technical architecture and design documentation:

- [Session Management Architecture](architecture-session-management.md) - Session storage, persistence, and lifecycle
- [Ralph Loop Architecture](architecture/ralph-loop.md) - PRD processing and autonomous execution
- [Viewer Service Decoupling](architecture/viewer-service-decoupling.md) - Session sharing architecture

---

## Integration Guides

- [GitHub Integration](GITHUB_INTEGRATION.md) - GitHub API integration and automation
- [Claude Tasks Collaboration](CLAUDE_TASKS_COLLABORATION.md) - Multi-agent task coordination

---

## Implementation Guides

Step-by-step guides for development:

- [Sprint 1 Quick Start](SPRINT1_QUICK_START.md) - Getting started with Sprint 1 features
- [Sprint 1 Implementation Guide](SPRINT1_IMPLEMENTATION_GUIDE.md) - Detailed implementation walkthrough

---

## Solutions

Documented solutions to specific problems:

### Best Practices
- [Electron Scheduler Feature Implementation](solutions/best-practices/electron-scheduler-feature-implementation-20260122.md)

### Reliability Issues
- [Loop Cleanup on Session Delete](solutions/reliability-issues/loop-cleanup-on-session-delete-20260122.md)

### UI Bugs
- [Dropdown ARIA Hidden Dialog Conflict](solutions/ui-bugs/dropdown-aria-hidden-dialog-conflict-20250123.md)

### Integration Issues
- [Terminal Resume Not Working](solutions/integration-issues/terminal-resume-not-working-20260125.md)

---

## Plans

Feature planning documents and implementation roadmaps:

- [Telegram Integration](plans/feat-telegram-integration.md)
- [Session Templates Plan](plans/session-templates-plan.md)
- [JSON Render AI-Generated UI](plans/feat-json-render-ai-generated-ui.md)
- [Inline Flowy Diagrams](plans/feat-inline-flowy-diagrams.md)
- [Multi-Source Skills Marketplace](plans/feat-multi-source-skills-marketplace.md)

---

## Roadmap

- [Product Roadmap](ROADMAP.md) - Feature roadmap and future plans

---

## Developer Documentation

Comprehensive guides for developers working on Vesper:

- [Architecture Overview](developer/architecture.md) - System architecture, core components, and design patterns
- [Development Setup](developer/development-setup.md) - Setting up your development environment
- [Testing Guide](developer/testing-guide.md) - Testing strategies and best practices
- [Contributing Guide](developer/contributing.md) - Contribution workflow and standards
- [Code Organization](developer/code-organization.md) - Project structure and code patterns
- [IPC Patterns](developer/ipc-patterns.md) - Inter-process communication best practices

---

## Testing Documentation

Testing infrastructure and examples:

- [Task Lists Architecture](developer/task-lists-architecture.md) - Task list system design and implementation

---

## Contributing

For contribution guidelines, see the [Developer Contributing Guide](developer/contributing.md) and the main [CONTRIBUTING.md](../CONTRIBUTING.md) file.

---

## API Documentation

For API reference documentation, see the inline code comments and TypeScript type definitions in the source code.

Key packages:
- `packages/shared/` - Core business logic and agent implementation
- `apps/electron/` - Desktop application (main, preload, renderer)
- `packages/ui/` - Shared UI components

---

*Last Updated: 2026-01-25*
