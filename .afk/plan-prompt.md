# ISSUES

Here are the open issues labeled `ready-for-agent`:

<issues-json>

!`gh issue list --state open --label ready-for-agent --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

# TASK

Analyze the issues and build a dependency graph. Each issue may reference blocking issues in its body ("Blocked by #N"). An issue is **unblocked** if every issue it depends on is already closed or not in the `ready-for-agent` list.

For each unblocked issue, assign a branch name using the format `afk/issue-{number}-{slug}` where `{slug}` is a short kebab-case summary of the title.

If an issue is a parent PRD that has implementation children, skip it — only pick leaf implementation issues.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"number": 42, "title": "Fix auth bug", "branch": "afk/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate. If there is nothing to work on, output `{"issues": []}`.
