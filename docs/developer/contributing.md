# Contributing to Vesper

Thank you for your interest in contributing to Vesper! This guide will help you get started with the contribution workflow.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Review Process](#review-process)
- [Community](#community)

## Code of Conduct

Vesper follows the [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md). Please read and follow it in all interactions.

## Getting Started

### Prerequisites

Before contributing, ensure you have:

1. **Development Environment** - See [Development Setup](development-setup.md)
2. **Understanding of Architecture** - Read [Architecture Overview](architecture.md)
3. **Knowledge of Testing** - Review [Testing Guide](testing-guide.md)

### First-Time Contributors

Great first issues are labeled with `good first issue` in the GitHub issue tracker. These are specifically chosen to be approachable for newcomers.

**Steps:**
1. Find an issue labeled `good first issue`
2. Comment on the issue expressing interest
3. Wait for maintainer confirmation before starting work
4. Follow the development workflow below

## Development Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/vesper.git
cd vesper

# Add upstream remote
git remote add upstream https://github.com/atherslabs/vesper.git
```

### 2. Create a Feature Branch

```bash
# Update your local main branch
git checkout main
git pull upstream main

# Create a feature branch
git checkout -b feature/your-feature-name
```

**Branch Naming Conventions:**

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/add-ssh-source` |
| `fix/` | Bug fixes | `fix/session-persistence` |
| `refactor/` | Code refactoring | `refactor/simplify-permissions` |
| `docs/` | Documentation | `docs/update-architecture` |
| `test/` | Test additions | `test/add-mcp-integration-tests` |
| `chore/` | Build/tooling | `chore/upgrade-electron` |

### 3. Make Your Changes

Follow these guidelines:

- **Keep changes focused** - One feature/fix per PR
- **Write tests** - Add tests for new functionality
- **Update documentation** - Keep docs in sync with code
- **Follow code style** - Match existing patterns
- **Add comments** - Explain complex logic

### 4. Test Your Changes

```bash
# Run type checking
bun run typecheck:all

# Run tests
bun test

# Run relevant E2E tests
bun run test:e2e:terminal  # If you changed terminal resume
bun run test:e2e:skills    # If you changed skills marketplace

# Manually test in the app
bun run electron:dev
```

### 5. Commit Your Changes

```bash
# Stage your changes
git add .

# Commit with a descriptive message
git commit -m "feat: add SSH source support"
```

**Commit Message Format:**

```
<type>: <short description>

<optional longer description>

<optional footer>
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `refactor:` - Code refactoring
- `docs:` - Documentation changes
- `test:` - Test changes
- `chore:` - Build/tooling changes
- `style:` - Code style changes (formatting, no logic change)
- `perf:` - Performance improvement

**Examples:**

```bash
# Simple feature
git commit -m "feat: add SSH connection support to sources"

# Bug fix with details
git commit -m "fix: resolve session persistence race condition

The debounced write queue wasn't properly handling concurrent
updates to the same session. This adds file locking to ensure
atomic writes.

Fixes #123"

# Breaking change
git commit -m "feat!: migrate to new MCP SDK version

BREAKING CHANGE: MCP servers using old SDK will need to upgrade
to v1.24.3 or higher. See migration guide in docs/migration.md"
```

### 6. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 7. Create a Pull Request

1. Go to https://github.com/atherslabs/vesper
2. Click "Pull Requests" → "New Pull Request"
3. Click "compare across forks"
4. Select your fork and branch
5. Fill out the PR template
6. Submit the PR

## Code Standards

### TypeScript Guidelines

#### Type Safety

```typescript
// ✓ Good - Explicit types
function createSession(workspace: Workspace, name: string): Session {
  return {
    id: generateId(),
    workspaceId: workspace.id,
    name,
    createdAt: new Date().toISOString(),
  };
}

// ✗ Bad - Implicit any
function createSession(workspace, name) {
  return {
    id: generateId(),
    workspaceId: workspace.id,
    name,
  };
}
```

#### Use Type Imports

```typescript
// ✓ Good - Type-only imports
import type { Session, Workspace } from '@vesper/core/types';
import { createSession } from './session-utils';

// ✗ Bad - Mixed imports
import { Session, Workspace, createSession } from './session-utils';
```

#### Avoid `any`

```typescript
// ✓ Good - Specific types
function processEvent(event: AgentEvent): void {
  if (event.type === 'result') {
    handleResult(event.result);
  }
}

// ✗ Bad - Using any
function processEvent(event: any): void {
  handleResult(event.result);
}

// ✓ Better - Use unknown for truly unknown types
function processUnknownData(data: unknown): void {
  if (isValidData(data)) {
    processValidData(data);
  }
}
```

### Code Style

#### Naming Conventions

```typescript
// PascalCase for types, interfaces, classes
type SessionStatus = 'active' | 'archived';
interface UserPreferences { ... }
class VesperAgent { ... }

// camelCase for variables, functions, methods
const sessionId = 'abc123';
function createSession() { ... }
async function loadWorkspace() { ... }

// UPPER_SNAKE_CASE for constants
const MAX_SESSIONS = 100;
const DEFAULT_PERMISSION_MODE = 'ask';

// kebab-case for file names
session-manager.ts
vesper-agent.ts
task-lists-ipc.ts
```

#### Function Organization

```typescript
// ✓ Good - Clear, single-responsibility functions
async function createSessionFromTemplate(
  workspace: Workspace,
  template: SessionTemplate
): Promise<Session> {
  const session = initializeSession(workspace, template);
  await applyTemplateSettings(session, template);
  await persistSession(session);
  return session;
}

// ✗ Bad - Doing too much
async function setupSession(workspace, template) {
  const id = generateId();
  const session = { id, workspaceId: workspace.id, ... };
  if (template.skills) {
    for (const skill of template.skills) {
      session.skills.push(skill);
    }
  }
  if (template.permissionMode) {
    session.permissionMode = template.permissionMode;
  }
  await writeFile(getSessionPath(session.id), JSON.stringify(session));
  return session;
}
```

#### Error Handling

```typescript
// ✓ Good - Specific error types
class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

async function loadSession(id: string): Promise<Session> {
  const session = await storage.get(id);
  if (!session) {
    throw new SessionNotFoundError(id);
  }
  return session;
}

// ✓ Good - Handle errors appropriately
try {
  const session = await loadSession(id);
  return session;
} catch (error) {
  if (error instanceof SessionNotFoundError) {
    // Handle specific error
    console.error('Session not found, creating new one');
    return createSession();
  }
  // Re-throw unexpected errors
  throw error;
}
```

### React Component Guidelines

#### Component Structure

```typescript
// ✓ Good - Clean component structure
interface SessionCardProps {
  session: Session;
  onSelect: (session: Session) => void;
}

export function SessionCard({ session, onSelect }: SessionCardProps) {
  const handleClick = () => {
    onSelect(session);
  };

  return (
    <div className="session-card" onClick={handleClick}>
      <h3>{session.name}</h3>
      <p>{session.status}</p>
    </div>
  );
}
```

#### Hooks

```typescript
// ✓ Good - Custom hooks for reusable logic
function useSession(sessionId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await window.electron.invoke('session:get', sessionId);
        setSession(data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [sessionId]);

  return { session, loading };
}

// Usage
function SessionView({ sessionId }: { sessionId: string }) {
  const { session, loading } = useSession(sessionId);

  if (loading) return <LoadingSpinner />;
  if (!session) return <NotFound />;

  return <SessionDetails session={session} />;
}
```

### Documentation

#### Code Comments

```typescript
/**
 * Creates a new session with the specified template.
 *
 * @param workspace - The workspace to create the session in
 * @param template - The template to apply to the session
 * @returns The created session
 * @throws {WorkspaceNotFoundError} If workspace doesn't exist
 */
async function createSessionFromTemplate(
  workspace: Workspace,
  template: SessionTemplate
): Promise<Session> {
  // Implementation
}

// Inline comments for complex logic
function calculateTaskProgress(tasks: Task[]): number {
  // Filter out pending tasks to get accurate progress
  const activeTasks = tasks.filter(t => t.status !== 'pending');

  // Edge case: No active tasks means 0% progress, not 100%
  if (activeTasks.length === 0) return 0;

  const completed = activeTasks.filter(t => t.status === 'completed').length;
  return (completed / activeTasks.length) * 100;
}
```

#### JSDoc for Public APIs

```typescript
/**
 * Task list storage interface.
 *
 * Provides CRUD operations for task lists with file-based persistence
 * and concurrent-safe operations using file locking.
 *
 * @example
 * ```typescript
 * const taskList = await createTaskList('My Tasks');
 * await createTask(taskList.id, 'Fix bug', 'Description');
 * ```
 */
export interface TaskListStorage {
  /**
   * Creates a new task list.
   *
   * @param name - The name of the task list (max 200 chars)
   * @param description - Optional description
   * @returns The created task list
   * @throws {TaskListError} If name is invalid
   */
  createTaskList(name: string, description?: string): Promise<TaskList>;

  // ... more methods
}
```

## Pull Request Process

### PR Template

When creating a PR, fill out the template completely:

```markdown
## Summary

Brief description of what this PR does and why.

## Changes

- Added SSH source type
- Updated source configuration schema
- Added SSH connection validation
- Updated documentation

## Testing

- [ ] Added unit tests for SSH connection
- [ ] Added integration tests for source lifecycle
- [ ] Manually tested SSH connection in dev environment
- [ ] Verified existing sources still work

## Screenshots (if applicable)

[Add screenshots for UI changes]

## Breaking Changes

None

## Checklist

- [x] Code follows project style guidelines
- [x] Tests added and passing
- [x] Documentation updated
- [x] Type checking passes
- [x] No console errors in development
```

### PR Size Guidelines

- **Small PRs** (< 200 lines) - Ideal, easy to review
- **Medium PRs** (200-500 lines) - Acceptable
- **Large PRs** (> 500 lines) - Should be split if possible

**Tips for keeping PRs small:**
- One feature/fix per PR
- Extract refactoring into separate PRs
- Break large features into incremental PRs

### Draft PRs

Use draft PRs for:
- Work in progress
- Seeking early feedback
- CI validation before full review

```bash
# Create draft PR with GitHub CLI
gh pr create --draft --title "WIP: Add SSH source"
```

## Review Process

### What Reviewers Look For

1. **Correctness** - Does it work as intended?
2. **Tests** - Are there adequate tests?
3. **Code Quality** - Is it readable and maintainable?
4. **Documentation** - Are docs updated?
5. **Performance** - Any performance concerns?
6. **Security** - Any security implications?

### Responding to Review Feedback

```bash
# Make requested changes
git add .
git commit -m "refactor: extract helper function as suggested"

# Push to update PR
git push origin feature/your-feature-name
```

### Getting Your PR Merged

Requirements for merge:
- [ ] All CI checks passing
- [ ] At least one approval from maintainer
- [ ] All review comments addressed
- [ ] No merge conflicts
- [ ] Documentation updated
- [ ] Tests passing

## Community

### Getting Help

- **GitHub Discussions** - Ask questions, share ideas
- **GitHub Issues** - Report bugs, request features
- **Discord** (if available) - Real-time chat

### Recognizing Contributors

All contributors are recognized in:
- GitHub contributors page
- Release notes (for significant contributions)
- README acknowledgments

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0. See [LICENSE](../../LICENSE) for details.

## Related Documentation

- [Development Setup](development-setup.md)
- [Architecture Overview](architecture.md)
- [Testing Guide](testing-guide.md)
- [Code Organization](code-organization.md)

---

*Last Updated: 2026-01-26*
