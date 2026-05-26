# Printing Press CLIs

CLI harnesses for agent-operated social platforms.

Current packages:

- `instagram-cli/` - direct Instagram browser CLI for profile login, posting, comments, and DMs.
- `tiktok-cli/` - direct TikTok browser CLI for profile login, video posting, comments, and DMs.
- `x-cli/` - direct X browser CLI for profile login, posts, replies, and DMs.
- `youtube-cli/` - direct YouTube browser CLI for profile login, full video uploads, Shorts uploads, and comments.

Use each platform folder as its own installable CLI package.

Recommended next check after install:

```bash
social doctor --json
```

Default browser engine:

- Use one Runner agent, `@social-publisher`, as the front door for all channel posting.
- Keep Instagram/TikTok/X/YouTube differences as platform playbooks inside this CLI harness, not as separate posting agents by default.
- `runner-cdp` inside RunnerOS. The CLI emits structured plans; Runner executes with native browser/CDP tools.
- `playwright` is optional fallback for standalone local execution.
