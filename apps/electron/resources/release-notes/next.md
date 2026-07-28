# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

- **OpenAI-compatible streams preserve chunks with empty tool-call arrays** — Custom endpoints that include `tool_calls: []` on ordinary content and terminal chunks no longer lose those chunks in the network interceptor, preventing valid responses from failing with `Stream ended without finish_reason`. Fixes [#995](https://github.com/craft-ai-agents/craft-agents-oss/issues/995).

## Breaking Changes
