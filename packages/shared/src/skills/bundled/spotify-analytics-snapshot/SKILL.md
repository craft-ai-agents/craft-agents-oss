---
name: spotify-analytics-snapshot
description: Weekly Spotify snapshot into Artist HQ context. Uses Spotify Web API credentials for reliable public artist data now; private Spotify for Artists streams/listeners require a logged-in browser capture lane.
---

# Spotify Analytics Snapshot

Use this skill on the weekly Spotify heartbeat, or when the user requests a fresh read of the artist's Spotify presence. The reliable automated lane is artist profile, followers, popularity, and genres. Top tracks are best-effort when Spotify returns them.

## Inputs

- `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in Settings > Secrets > Spotify.
- Artist HQ Profile `spotifyProfile`, `SPOTIFY_ARTIST_ID`, or `--artist-id`.
- Optional `CRAFT_WORKSPACE_PATH` / `--workspace` so the script can write `artist-spotify-snapshot`.

## Workflow

1. For normal weekly sync, run:

```bash
bun "$CRAFT_APP_ROOT/packages/shared/src/skills/bundled/spotify-analytics-snapshot/scripts/api-snapshot.ts" \
  --workspace "$CRAFT_WORKSPACE_PATH"
```

2. This uses Spotify's public Web API and writes:
   - `data/spotify/snapshots/<YYYY-MM-DD>-web-api.json`
   - Artist HQ context doc `artist-spotify-snapshot`
3. If the user explicitly needs streams, listeners, saves, skips, top cities, or source-of-streams, explain that those are Spotify for Artists metrics and require a separate logged-in browser capture. Do not fabricate them from public API data.
4. If a private S4A capture is manually obtained as JSON, use `snapshot.ts --from-stdin` or `--from-fixture` to normalize and store it.
5. Run `delta-brief.ts` only when there are comparable snapshots of the same data source.

## Output Contract

Public API snapshot:

```json
{
  "version": 1,
  "dataSource": "spotify-web-api",
  "snapshotDate": "2026-04-25",
  "windowDays": 0,
  "artist": { "name": "...", "spotifyArtistId": "...", "spotifyUrl": "...", "genres": [] },
  "metrics": {
    "followers": 0,
    "popularity": 0
  },
  "geo": { "topCities": [] },
  "tracks": [
    { "id": "...", "name": "...", "popularity": 0, "spotifyUrl": "..." }
  ],
  "playlistsDriving": [],
  "sources": {},
  "partial": false,
  "errors": [],
  "updatedAt": "ISO timestamp"
}
```

`data/spotify/briefs/<YYYY-MM-DD>.md` is a short markdown brief with:

- Window comparison (which two snapshots).
- Real movers: streams, listeners, followers, save rate, skip rate. Each with absolute and percent change.
- Top track movement (top 3 by stream delta).
- New playlist features.
- Removed playlist features.
- Geo shifts worth noting.
- Source-of-streams shifts (e.g., dependency on editorial growing).
- Honest interpretation: signal vs. noise. Below ±10% is generally noise unless it's a sustained two-snapshot trend.

## Failure Handling

- Missing Spotify client credentials → stop and point user to Settings > Secrets > Spotify.
- Missing artist ID/profile → stop and ask for Artist Profile > Spotify profile.
- Spotify API failure → report the status and do not write fake data.
- Private S4A login expired → stop, report, do not retry blindly.
- Whole private scrape fails → write nothing rather than fabricate.
- No prior snapshot → snapshot still writes. Brief script reports "no prior snapshot, no delta."

## Never

- Never fabricate numbers.
- Never modify a past snapshot.
- Never bypass approvals — this skill is read-only.
- Never represent public Spotify API popularity/followers as Spotify for Artists streams/listeners.
- Never silently drop a tracked playlist feature; surface its disappearance as an anomaly.
