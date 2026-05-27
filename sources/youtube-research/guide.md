# YouTube Research

Use this source for read-only YouTube discovery and analysis through the bundled `youtube-pp-cli` wrapper.

## Connect

Open Tools -> YouTube Research and save a YouTube Data API key. RunnerOS stores it and injects `YOUTUBE_API_KEY` for the bundled wrapper. A saved key is configured but not validated until `doctor` or a real read call succeeds.

## Commands

- Doctor: `node bin/youtube-research.mjs doctor`
- Search: `node bin/youtube-research.mjs youtube search-list --q "<query>" --max-results 5 --agent`
- Bulk search: `node bin/youtube-research.mjs youtube search-bulk "<query one>" "<query two>" --top 3 --agent`
- Transcript: `node bin/youtube-research.mjs youtube videos-transcript <videoId> --lang en --agent`
- Embed: `node bin/youtube-research.mjs youtube videos-embed <videoId> --format markdown`
- Related: `node bin/youtube-research.mjs youtube videos-related <videoId> --limit 5 --agent`
- Top comments: `node bin/youtube-research.mjs youtube videos-comments <videoId> --top 10 --agent`
- Channel uploads: `node bin/youtube-research.mjs youtube channel-uploads @handle --top 10 --agent`

## Rules

- This is read-only. Do not use it for publishing, commenting, uploads, channel management, or any account mutation.
- Use `--agent` for compact JSON, no prompts, no color.
- Use `--select` when output would be large.
- For posting/uploading/commenting, use the Social Publisher / Printing Press Social source instead.
