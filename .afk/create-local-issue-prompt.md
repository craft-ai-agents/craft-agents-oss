# TASK

Create a local issue file from the following description:

<description>
{{DESCRIPTION}}
</description>

1. Generate a short, clear title (under 80 characters).
2. Generate a kebab-case slug (2–5 words) for the filename.
3. Create `.scratch/issues/<slug>.md` — create the directory if it does not exist — using this exact format:

```
# <title>

Status: needs-triage

## Description

<description text>

## Comments

```

Do not modify any other files.

Once done, output <promise>COMPLETE</promise>.
