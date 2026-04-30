# TASK

Implement issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are running in a git worktree already checked out on branch `{{BRANCH}}`. Do not switch branches.

Fetch the full issue and any parent PRD using `gh issue view`:

```
gh issue view {{ISSUE_NUMBER}} --comments
```

Only work on the issue specified. Do not touch unrelated code.

# CONTEXT

Recent commits:

<recent-commits>

!`git log -n 10 --format="%H %ad %s" --date=short`

</recent-commits>

# EXPLORATION

Explore the codebase and fill your context with relevant information before writing any code. Read tests that touch the area you are working in — they show both the expected behavior and the testing patterns used in this project.

# EXECUTION

Use TDD where applicable:

1. RED — write a failing test that captures the acceptance criterion
2. GREEN — write the minimum implementation to pass it
3. REPEAT until all acceptance criteria are covered
4. REFACTOR for clarity

# FEEDBACK LOOPS

Before committing, run:

```
bun run typecheck:shared
bun test
```

Fix any type errors or test failures before proceeding.

# COMMIT

Make one or more git commits. Each commit message must:

1. Start with `AFKbot:` prefix
2. Describe what was done and reference the issue (`#{{ISSUE_NUMBER}}`)
3. Note key decisions or trade-offs

Example: `AFKbot: add GitPanel status section (#4) — uses getGitStatus IPC, empty state for non-git dirs`

Do not close the issue — that is handled by the merger.

If the task is not fully complete, leave a comment on the issue explaining what was done and what remains.

# RULES

- Only work on issue #{{ISSUE_NUMBER}}.
- Do not modify files outside the scope of this issue.
- Follow the patterns in CLAUDE.md files and existing tests.
