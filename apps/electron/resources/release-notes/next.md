# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

- Fixed IME composition text being invisible and placeholder hints overlaying the input during the entire composition phase. `showPlaceholder` was computed from React state (`safeValue`) which stays `''` while `onChange` is blocked during composition, making the preedit text transparent and keeping the rotating placeholder overlay visible.

## Breaking Changes
