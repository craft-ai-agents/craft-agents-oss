# YouTube Research Tool

Repo-owned wrapper for the bundled `youtube-pp-cli` binary from Printing Press Library.

Use this for read-only YouTube research: search, transcripts, embeds, related videos, comments, and channel uploads.

```bash
node bin/youtube-research.mjs doctor
node bin/youtube-research.mjs youtube search-list --q "sourdough scoring" --max-results 5 --agent
node bin/youtube-research.mjs youtube videos-transcript dQw4w9WgXcQ --lang en --agent
```

RunnerOS injects a saved `YOUTUBE_API_KEY` from Tools -> YouTube Research when available. A saved key means the source is configured; agents should still run `doctor` before live research because RunnerOS does not validate the key during save.

Bundled binary provenance, checksums, and third-party license files live next to this README:

- `THIRD_PARTY.md`
- `LICENSE.youtube-pp-cli.txt`
- `NOTICE.youtube-pp-cli.txt`
