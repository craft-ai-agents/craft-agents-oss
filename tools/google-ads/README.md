# Google Ads Tool

Repo-owned wrapper for the bundled `google-ads-pp-cli` binary.

Use from this directory:

```bash
node bin/google-ads.mjs doctor --agent
node bin/google-ads.mjs auth status --agent
node bin/google-ads.mjs customers list-accessible-customers --agent
node bin/google-ads.mjs google-ads-fields search --agent --query campaign
```

The wrapper resolves the binary from packaged app resources first, then dev resources, then `PATH`.
