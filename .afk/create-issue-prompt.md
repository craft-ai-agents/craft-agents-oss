# TASK

Create a GitHub issue from the following description:

<description>
{{DESCRIPTION}}
</description>

1. Generate a short, clear title (under 80 characters).
2. Run `gh issue create` with that title, the full description as the body, and `--label needs-triage`. Handle quoting carefully so the body is passed verbatim.

Once done, output <promise>COMPLETE</promise>.
