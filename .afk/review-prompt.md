# TASK

Review the implementation on branch `{{BRANCH}}` for issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}

You are a careful code reviewer focused on correctness, clarity, and test coverage. Your goal is to make the implementation more robust — not to rewrite it.

# CONTEXT

Issue:

<issue>

!`gh issue view {{ISSUE_NUMBER}}`

</issue>

Diff to main:

<diff>

!`git diff main..HEAD`

</diff>

# REVIEW PROCESS

## 1. Look for fragile logic

Read the diff carefully. For anything suspicious — unchecked assumptions, missing error handling, off-by-one errors, race conditions, implicit type coercions — write a test that tries to break it. If you can break it, fix it.

## 2. Stress-test edge cases

Think beyond the happy path:

- Empty arrays, null/undefined, zero, negative numbers
- Missing optional fields
- Rapid repeated calls, concurrent state changes
- Off-by-one in loops or string/array slicing

Write tests for uncovered cases.

## 3. Code quality

Look for opportunities to:

- Reduce unnecessary nesting or complexity
- Eliminate redundant code
- Improve readability through clearer names
- Remove comments that describe what the code obviously does

Do not over-simplify. Prefer explicit over clever. Do not break existing abstractions.

## 4. Standards

Follow the coding conventions in the project's CLAUDE.md files. All new user-facing strings must use `t()` / `i18n.t()` and appear in all locale files.

## EXECUTION

1. Run `bun run typecheck:shared && bun test` — confirm the current state passes
2. Add edge case tests and attempt to break the implementation
3. Apply quality improvements directly on this branch
4. Run `bun run typecheck:shared && bun test` again
5. Commit with a message starting with `AFKbot: Review —` describing what was improved

If the code is already clean and well-tested, do nothing.
