# ISSUES

Here are the open issues in Linear ready for an agent:

<issues-json>

!`bun "{{LINEAR_CLI}}" list --label ready-for-agent --full`

</issues-json>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `afk/issue-{identifier-lowercase}-{slug}` where `{identifier-lowercase}` is the Linear identifier in lowercase (e.g. `rpi-42`) and `{slug}` is a short kebab-case summary of the title.

If the issue appears to be a PRD and it has implementation issues which link to it, the PRD cannot be worked on.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "uuid", "identifier": "RPI-42", "title": "Fix auth bug", "branch": "afk/issue-rpi-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
