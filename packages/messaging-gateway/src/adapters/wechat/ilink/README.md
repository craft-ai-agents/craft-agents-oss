# Vendored: @tencent-weixin/openclaw-weixin

This directory contains TypeScript code vendored from Tencent's
[`@tencent-weixin/openclaw-weixin`](https://www.npmjs.com/package/@tencent-weixin/openclaw-weixin)
package, the official iLink ClawBot transport for personal WeChat (微信).

- **Upstream package**: `@tencent-weixin/openclaw-weixin`
- **Version pinned**: `2.4.4`
- **License**: MIT — see [`LICENSE`](./LICENSE)
- **Copyright**: Copyright (C) 2026 Tencent. All rights reserved.

## Why vendor?

The upstream package is published as an [OpenClaw](https://www.npmjs.com/package/openclaw)
channel plugin. It depends on `openclaw` as a peer dependency, expects the
OpenClaw runtime to own message routing (`channelRuntime` / `processOneMessage`),
and persists state under an OpenClaw-managed directory. Craft Agents is not an
OpenClaw host, so the transport layer is vendored here, decoupled from the
plugin host, and wired into the standard `PlatformAdapter` contract by
[`../index.ts`](../index.ts).

## Local adaptations

The vendored snapshot mirrors upstream verbatim where possible. Local changes
are limited to:

- **`monitor/monitor.ts`** — the OpenClaw `channelRuntime` / `processOneMessage`
  coupling is replaced by an injected `onMessage` callback so the
  `WeChatAdapter` owns normalization, deduplication, and routing.
- **`storage/state-dir.ts`** — state directory resolution falls back to
  `$CRAFT_AGENT_HOME` / `~/.craft-agent`; the adapter sets it explicitly via
  `setStateDir()` during `initialize()`.
- **`util/logger.ts`** — daily JSON-lines log file under the OS temp dir,
  level read from `OPENCLAW_LOG_LEVEL`. This logger is preserved from upstream
  for parity with their debugging tooling; the adapter additionally logs
  through the host's `MessagingLogger`.

All other files preserve upstream behaviour: the long-poll loop, sync-buf
offset persistence, session-expiry handling, CDN upload/download with
AES-128-ECB, silk audio transcode, and QR login.

Each `.ts` file in this tree carries a one-line attribution header citing
this README and the upstream package; the canonical MIT license text lives
in [`LICENSE`](./LICENSE).
