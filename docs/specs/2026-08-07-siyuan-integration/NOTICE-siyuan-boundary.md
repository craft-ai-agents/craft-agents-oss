# NOTICE — SiYuan integration boundary

**Craft does not distribute SiYuan.**

- The Craft Agents product (Apache-2.0) does **not** ship SiYuan source code, binaries, UI assets, or modified forks in the monorepo, installer, or auto-update channel.
- Integration with SiYuan is **HTTP API only** (loopback or user-configured base URL) plus an optional host surface that embeds the **user-running** SiYuan web UI.
- **User-installed SiYuan is a separate program.** The user obtains, installs, updates, and licenses SiYuan under SiYuan’s own terms (AGPL-3.0 upstream). Craft’s “Detect SiYuan” assist only checks local install paths and whether something listens on the default kernel port; it never downloads SiYuan.
- Managed kernel mode (Craft spawning/bundling a kernel) is **not enabled**. See [g2-decision-record.md](./g2-decision-record.md) and [08-licensing.md](./08-licensing.md).

This notice is an engineering boundary statement, not legal advice.
