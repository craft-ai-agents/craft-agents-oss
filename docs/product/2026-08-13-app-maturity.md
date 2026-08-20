# App maturity (read-only)

- **Date:** 2026-08-13
- **No feature work.**

| App | Classification | Evidence |
|---|---|---|
| `apps/electron` | **production** | Full main/renderer, electron-builder, entitlements, release-notes through 0.11.4+ |
| `apps/cli` | **production-adjacent** | Tests (`client.test.ts`, `commands.test.ts`, `run.test.ts`) |
| `apps/viewer` | **production-adjacent** | Cloudflare Pages functions + Vite app for public shares |
| `apps/webui` | **experimental / secondary** | Login + adapter; not the Electron primary |
| `apps/ios` | **experimental** | Real SwiftPM kit + SwiftUI app + tests; README: macOS+Xcode only; not in root Electron ship path |
| `apps/cloud-gateway` | **experimental** | `0.1.0`, Wrangler worker, `@cloudflare/computer` **alpha**, phase G2 in its own package.json |
| `apps/modal-gateway` | **experimental** | Single `app.py` Modal fallback (phase G4); secrets via Modal secret name only |

Dead: none of the three named apps is an empty stub. None is proven production-ready.
