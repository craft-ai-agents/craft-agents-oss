# TASK

Merge the following branches into `main`:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them by reading both sides and choosing the correct resolution — prefer the intent of the newer branch when in doubt
3. After resolving conflicts, run `bun run typecheck:shared && bun test` to verify nothing is broken
4. If tests fail, fix the issues before moving to the next branch

After all branches are merged, make a single summary commit.

# CLOSE ISSUES

For each merged branch, close its corresponding issue with a comment explaining what was implemented. If closing an issue would complete all children of a parent PRD, close the parent too.

Issues to close:

{{ISSUES}}

Use `gh issue close <number> --comment "..."` for each.
