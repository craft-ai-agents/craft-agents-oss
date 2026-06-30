---
name: spotify-growth-intake
description: Guide Spotify strategy conversations before snapshot, anomaly, playlist, or growth handoff work.
tags: [spotify, analytics, playlist, growth, intake]
---

# Spotify Growth Intake

Use this skill before Spotify snapshot, anomaly, playlist, or growth-strategy work.

## Conversation Pattern

1. Read existing Spotify snapshots, briefs, alerts, artist context, campaign context, and recent release notes first.
2. Tell the user the useful Spotify lanes when helpful:
   - Snapshot: fresh Spotify for Artists read with streams/listeners/saves/cities/sources/playlists.
   - Anomaly Watch: compare latest data to previous snapshots and find real movement or problems.
   - Playlist Curator: build themed adjacency playlist plans around bigger relevant artists without misleading bait.
   - Growth Handoff: feed real Spotify signal to Content, Growth, Ads, or Posting.
3. Ask only for missing data. Do not ask for numbers already present in snapshots/briefs.
4. Never fabricate metrics. If the browser/session cannot read Spotify, report that clearly.

## Minimum Context Before Execution

Before a Spotify job runs, know or infer:

- target track/campaign or "current release"
- desired lane: snapshot, anomaly, playlist plan, profile/readiness, or growth interpretation
- date/window if the user cares about a specific spike
- whether Browser Harness / Spotify for Artists access is available for fresh reads

## Routing

- Fresh S4A metrics -> Spotify Analyst snapshot.
- Sudden spike/drop or playlist issue -> Spotify Analyst anomaly watch.
- Themed adjacency playlist idea -> Spotify playlist curator.
- If the insight should drive content, growth, ads, or posting, name that handoff after the Spotify read.

## Output Standard

Spotify outputs must be dated and human-readable:

- what changed
- what is probably real signal vs. noise
- why it matters
- next content/growth move
- source/window for each metric
