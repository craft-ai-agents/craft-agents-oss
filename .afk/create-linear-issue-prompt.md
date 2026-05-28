# TASK

Create a Linear issue from the following description:

<description>
{{DESCRIPTION}}
</description>

1. Generate a short, clear title under 80 characters.
2. Run `bun .afk/linear.ts resolve` and find the label ID for `needs-triage`.
3. Run `bun .afk/linear.ts create` with that title, the full description as `--desc`, and the `needs-triage` label ID as `--label`. Handle quoting carefully so the description is passed verbatim.

Once done, output <promise>COMPLETE</promise>.
