# ADR 0001 — Skill Remote Import: API-first with git clone fallback

**Status:** Accepted

## Context

The Skill Import Modal's Remote tab must resolve user-supplied input into skill files. Input can be a GitHub shorthand (`owner/repo`), a full GitHub/GitLab URL, a direct path to a subdirectory, or a raw git URL (including SSH). Each form requires a different fetch mechanism.

## Decision

Parse the input string first:

- If it resolves to a **GitHub or GitLab URL** → use the respective REST API (GitHub Contents API / GitLab Repository Files API) to list directories and fetch `SKILL.md` files. No `git` binary required; plain HTTP in Electron's main process.
- Otherwise (raw git URL, SSH, self-hosted) → shell out to `git clone --depth 1 --sparse` into a temp directory, then read from disk.

Skill discovery in both cases: scan for any directory containing `SKILL.md`, up to 2 levels deep. If multiple skills are found, show the **Skill Picker**. Only public repos are supported in v1 — 403/404 from the API surfaces a "make sure this repo is public" error.

## Alternatives considered

- **API-only:** Cleaner but excludes SSH and self-hosted git URLs — a real limitation for teams with private infrastructure.
- **git clone only:** Works universally but requires `git` on the user's machine and is slower for the common case (GitHub public repos).

## Consequences

- Two fetch code paths to maintain. The URL parser must correctly distinguish GitHub/GitLab URLs from all other git URLs.
- The depth-2 scan is an intentional cap to avoid traversing large monorepos; skill authors should place skills within 2 directory levels of the repo root.
- Private repo support is deferred; the zip upload path is the workaround for private skills in v1.
