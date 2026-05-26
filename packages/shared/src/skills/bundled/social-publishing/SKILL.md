---
name: social-publishing
description: "Use when operating social publishing workflows for Instagram, TikTok, X, or YouTube: cross-posting campaigns, posting videos/images/text, replying/commenting, sending DMs, checking channel readiness, or preparing browser-executed social posts through RunnerOS. Built for the @social-publisher agent and Printing Press Social CLI."
tags: [social, publishing, instagram, tiktok, x, youtube]
metadata:
  version: 1.0.0
  last_verified: 2026-05-26
---

# Social Publishing

Use this skill to run social channel work through RunnerOS with the bundled Printing Press Social CLI and `browser_tool`.

## Core Flow

1. Read `sources/printing-press-social/guide.md` when available.
2. Run `node src/social.mjs doctor --json` from `tools/printing-press-social`.
3. For post/comment/DM, run the exact CLI action with `--dry-run --json`.
4. Validate the payload against the platform checklist below.
5. Ask for explicit approval before any live publish/send action.
6. Execute through Runner `browser_tool` using the dry-run JSON as the action contract.
7. Return a receipt with platform, profile, action, payload summary, media path, target, timestamp, and observed result.

## Profile Sessions

Explain this model when the user is setting up social publishing or seems confused:

- Each platform/profile should have its own saved browser session, such as `tiktok/main`, `instagram/brand`, or `youtube/client-a`.
- Users should log in once per profile. The saved browser session keeps cookies/login state so they do not retype passwords every run.
- Passwords, recovery codes, tokens, cookies, and 2FA secrets must never be written into Workspace Context, memory, source guides, or chat prompts.
- Workspace Context should store only non-secret defaults: profile IDs, handles, account URLs, tone, posting defaults, and account notes.
- Before live work, run `node src/social.mjs doctor --live --json` and verify the visible logged-in account matches the requested profile.
- If a session expires, pause and guide the user through logging in again for that specific profile.

Use profile-specific commands:

```bash
node src/social.mjs post tiktok --profile client-a --dry-run --json
node src/social.mjs post instagram --profile brand --dry-run --json
node src/social.mjs post youtube --profile main --dry-run --json
```

If the user asks "how does this work?", answer briefly: "You create named profiles once, log each profile in once, then the agent reuses those local browser sessions. Context stores which profile to use and how to write; secrets stay out of prompts."

## Agent Shape

Use one execution agent for all platforms: `@social-publisher`.

Do not split posting into one agent per platform by default. Keep platform differences in the playbook. Use other agents only for separate roles, such as writing, creative review, research, or asset generation.

## Approval Gate

Never perform these without approval of exact details:

- publish, schedule, upload, comment, reply, DM
- delete, edit after publish, follow/unfollow, block/report
- credential entry, account switch, billing/payment, age-gated or sensitive submission

Approval must name the platform, profile, target URL or recipient when relevant, final copy, media path, visibility, and whether it is live now or draft/scheduled.

## Universal Payload Rules

- Prefer vertical 9:16 video for short-form reuse across TikTok, Instagram Reels, and YouTube Shorts.
- Keep key text and subject matter away from top/bottom UI chrome; center-safe compositions survive more platforms.
- Use native-feeling captions: clear hook first, then context, then CTA only if useful.
- Avoid external links in primary post copy unless the user specifically wants traffic over reach.
- Validate rights for music, clips, images, likenesses, and brand assets before upload.
- If platform guidance matters to performance or compliance, refresh research before high-stakes publishing.

## Platform Detail

Load `references/platform-playbooks.md` only when you need platform-specific requirements or posting heuristics.

Use these quick defaults:

- TikTok: vertical video, fast first frame, native caption, minimal hashtags.
- Instagram: Reels for vertical video; carousel/feed when visuals matter more than video discovery.
- X: concise text, one clear point, avoid mixing too many media types; attach up to four images or one video.
- YouTube: Shorts for square/vertical videos up to 3 minutes; long-form for 16:9 depth.

## Receipt Format

Return:

```text
Status: posted | drafted | blocked | needs-user
Platform:
Profile:
Action:
Target:
Copy:
Media:
Visibility:
Observed result:
URL or evidence:
Timestamp:
```
