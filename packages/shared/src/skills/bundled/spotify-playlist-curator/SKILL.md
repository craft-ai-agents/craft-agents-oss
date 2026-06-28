---
name: spotify-playlist-curator
description: Build Spotify adjacency playlists where the artist's tracks sit naturally between bigger comparable artists. Generates a sandwich-pattern plan first, then applies only after explicit approval and only when Spotify MCP/API/OAuth tooling is available.
---

# Spotify Playlist Curator

Use this skill when the artist wants a Spotify playlist that creates tasteful adjacency: bigger comparable artists set the lane, and the artist's songs are placed naturally inside that emotional pocket.

## Core Rule

Plan first. Never create or modify a Spotify playlist until the user approves the exact playlist title, description, visibility, track order, and artist-track placements.

## Inputs

- Comparable big artists and tracks in the same lane.
- The artist's own Spotify track IDs.
- A mood/scene title for the playlist.
- Target length, usually 25-30 tracks.
- Featured-artist ratio, usually 15-25%.

Expected JSON files:

```json
{
  "comparableTracks": [
    {
      "spotifyArtistId": "artist-id",
      "artistName": "Comparable Artist",
      "tracks": [
        { "id": "track-id", "name": "Track Name", "durationMs": 0, "popularity": 0 }
      ]
    }
  ]
}
```

```json
{
  "ourTracks": [
    { "id": "track-id", "name": "Our Song", "durationMs": 0, "preferredFeatureWeight": 1 }
  ]
}
```

## Build A Plan

```sh
bun packages/shared/src/skills/bundled/spotify-playlist-curator/scripts/build-plan.ts \
  --comparable-tracks data/spotify/comparable-tracks.json \
  --our-tracks data/spotify/our-tracks.json \
  --theme "Drive Home Slow" \
  --target-length 28 \
  --our-ratio 0.20 \
  --our-artist-name "Artist Name" \
  --out data/spotify/playlist-plans/drive-home-slow.json
```

The planner:

- Uses only provided Spotify track IDs.
- Spreads the artist's tracks through the playlist.
- Avoids same comparable artist back-to-back where possible.
- Writes JSON plus a readable Markdown review file.

## Apply Gate

After user approval:

```sh
bun packages/shared/src/skills/bundled/spotify-playlist-curator/scripts/apply-plan.ts \
  --plan data/spotify/playlist-plans/drive-home-slow.json \
  --apply \
  --confirm
```

This writes an apply checklist. If a Spotify MCP/API/OAuth tool is available in the session, use that approved checklist to create the playlist. If no Spotify write tool is available, stop and return the exact payload plus the missing setup requirement.

## Naming Discipline

Allowed:

- Mood: "Drive Home Slow", "Confession Hour"
- Scene: "Brooklyn Night Walk", "Bedroom Pop Afterparty"
- Vibe: "Sad and Soft", "Heart Open"

Avoid:

- "Songs Like [Big Artist]"
- "[Big Artist Song] Radio"
- Misleading titles that imply another artist owns or endorsed the playlist.

## Never

- Never invent Spotify IDs.
- Never imply Spotify editorial placement.
- Never promise streams, followers, algorithmic boosts, or playlisting outcomes.
- Never create, publish, or edit a playlist without explicit approval in the current conversation.
- Never hide that the artist's tracks are part of the curation.
