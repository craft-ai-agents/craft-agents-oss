# TASK

Fix the issue at {{ISSUE_PATH}}: {{ISSUE_TITLE}}

Read the issue file:

<issue>

!`cat {{ISSUE_PATH}}`

</issue>

If the issue references a parent PRD (look for a `PRD:` line in the file), read that file too.

Only work on the issue specified.

Work on branch {{BRANCH}}. Make commits, run tests.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use RGR to complete the task.

1. RED: write one test
2. GREEN: write the implementation to pass that test
3. REPEAT until done
4. REFACTOR the code

# FEEDBACK LOOPS

Before committing, run `npm run typecheck` and `npm run test` to ensure the tests pass.

# COMMIT

Make a git commit. The commit message must:

1. Start with `RALPH:` prefix
2. Include task completed + issue path reference
3. Key decisions made
4. Files changed
5. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is not complete, append a note under `## Comments` in {{ISSUE_PATH}} describing what was done and what remains.

Do not update the Status field — this will be done by the merge step.

Once complete, output <promise>COMPLETE</promise>.

# FINAL RULES

ONLY WORK ON A SINGLE TASK.
