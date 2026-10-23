# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Sign in to MCP servers that reject the OAuth relay** — Some MCP servers only accept a local (loopback) redirect address when signing in, and refuse the Craft Agents relay with an error like "only HTTP loopback callbacks". Add `"oauthRelay": false` to the source's `mcp` block to send the sign-in straight back to the app on `localhost` instead. Leave it unset to keep using the relay. See **Sources → MCP servers → Authentication** in the docs.

## Improvements

## Bug Fixes

- **Tool call heartbeats no longer appear as repeated invocations** — Long-running tool calls stay as one running activity in the conversation while SDK heartbeat records arrive. Fixes #1008.

## Breaking Changes
