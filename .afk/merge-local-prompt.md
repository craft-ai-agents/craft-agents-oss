# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, run `npm run typecheck` and `npm run test` to verify everything works
4. If tests fail, fix the issues before proceeding to the next branch

After all branches are merged, make a single commit summarizing the merge.

# CLOSE ISSUES

For each merged branch, mark its local issue file as done:

1. Read the file
2. Replace the line `Status: ready-for-agent` with `Status: done`
3. Write the file back

Here are all the issues (path: title):

{{ISSUES}}

If closing an issue would complete a parent PRD (check for `PRD:` references pointing up to a `.scratch/<feature>/PRD.md`), update the PRD's Status to `done` as well.

Once you've merged everything you can, output <promise>COMPLETE</promise>.
