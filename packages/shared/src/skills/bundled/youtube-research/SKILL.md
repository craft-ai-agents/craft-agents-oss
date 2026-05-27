---
name: youtube-research
description: Use RunnerOS' bundled YouTube Research source for read-only YouTube search, transcripts, embeds, related videos, comments, and channel uploads.
---

# YouTube Research

Use this skill when the user wants to find YouTube videos, inspect channels, pull transcripts, find related videos, collect top comments, or generate embed snippets.

Use Social Publisher instead for uploads, posting, live comments, profile login, or YouTube Studio work.

## Source

Use the bundled `youtube-research` source:

```bash
cd tools/youtube-research
node bin/youtube-research.mjs <command>
```

RunnerOS injects `YOUTUBE_API_KEY` after the user connects Tools -> YouTube Research. Treat a connected key as configured, not proven valid, until `doctor` or a real read call succeeds.

## First Checks

```bash
cd tools/youtube-research && node bin/youtube-research.mjs doctor
cd tools/youtube-research && node bin/youtube-research.mjs which "search videos by keyword" --agent
```

If auth is missing, tell the user to open Tools -> YouTube Research and save a YouTube Data API key.

## Core Commands

```bash
cd tools/youtube-research && node bin/youtube-research.mjs youtube search-list --q "topic" --max-results 5 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube search-bulk "topic one" "topic two" --top 3 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-transcript dQw4w9WgXcQ --lang en --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-embed dQw4w9WgXcQ --format markdown
cd tools/youtube-research && node bin/youtube-research.mjs youtube videos-comments dQw4w9WgXcQ --top 10 --agent
cd tools/youtube-research && node bin/youtube-research.mjs youtube channel-uploads @veritasium --top 10 --agent
```

Use `--select` to keep JSON small.

## Safety

- Read-only only.
- Do not publish, upload, comment, rate, edit, delete, or manage channels with this skill.
- Report quota/auth failures plainly.
- Summarize findings into usable research, not raw dumps.
