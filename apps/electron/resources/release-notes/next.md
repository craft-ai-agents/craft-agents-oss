# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

- Fixed Chinese IME first-character input conflicting with English auto-capitalisation. On some macOS/Electron builds the native `input` event fires before `compositionstart`, causing the auto-capitalise logic to capitalise the first pinyin letter and corrupt the IME composition session.

## Breaking Changes
