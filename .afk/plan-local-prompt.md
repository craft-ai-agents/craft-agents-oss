# ISSUES

Here are the open local issues ready for an agent:

<issues>

!`find .scratch -type f -name "*.md" -path "*/issues/*" | sort | xargs grep -l "^Status: ready-for-agent" 2>/dev/null | while read f; do echo "### $f"; cat "$f"; echo; done`

</issues>

# TASK

Analyze the open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, derive a branch name from its file path using the format `afk/local-{slug}` where `{slug}` is the filename without the `.md` extension.

If the issue appears to be a PRD and it has implementation issues which link to it, the PRD cannot be worked on.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"path": ".scratch/feature/issues/01-fix-auth.md", "title": "Fix auth bug", "branch": "afk/local-01-fix-auth"}]}
</plan>

Include only unblocked issues. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
