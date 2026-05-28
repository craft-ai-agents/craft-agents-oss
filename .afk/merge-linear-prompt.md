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

For each branch that was merged, close its Linear issue using the CLI:

```
bun "{{LINEAR_CLI}}" close <issue-id>
```

Here are all the issues (identifier and id):

{{ISSUES}}

If closing one issue would complete a parent PRD, close the PRD too.

Once you've merged everything you can, output <promise>COMPLETE</promise>.
