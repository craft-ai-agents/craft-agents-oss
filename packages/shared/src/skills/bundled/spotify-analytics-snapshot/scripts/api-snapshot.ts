#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { loadContextDoc, upsertContextDoc } from '../../../../workspace-context/index.ts';

interface CliOptions {
  artistId: string | null;
  artistProfile: string | null;
  workspace: string | null;
  out: string;
  market: string;
  writeContext: boolean;
}

interface SpotifyArtist {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  followers?: { total?: number };
  external_urls?: { spotify?: string };
  images?: Array<{ url?: string; width?: number; height?: number }>;
}

interface SpotifyTrack {
  id: string;
  name: string;
  popularity?: number;
  external_urls?: { spotify?: string };
  album?: { name?: string; release_date?: string };
}

const DEFAULT_OUT_DIR = 'data/spotify/snapshots';
const SNAPSHOT_CONTEXT_SLUG = 'artist-spotify-snapshot';
const ARTIST_PROFILE_CONTEXT_SLUG = 'artist-profile';

function usage(): string {
  return `Usage:
  bun packages/shared/src/skills/bundled/spotify-analytics-snapshot/scripts/api-snapshot.ts [options]

Options:
  --artist-id <id>          Spotify artist ID.
  --artist-profile <url|id> Spotify artist URL/URI/ID.
  --workspace <path>        Workspace root. If present, can read artist-profile and write Artist HQ context.
  --out <dir>               Snapshot directory. Default: ${DEFAULT_OUT_DIR}
  --market <code>           Market for top tracks. Default: US
  --no-context              Do not write artist-spotify-snapshot context.

Requires SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    artistId: null,
    artistProfile: null,
    workspace: process.env.CRAFT_WORKSPACE_PATH ?? null,
    out: DEFAULT_OUT_DIR,
    market: 'US',
    writeContext: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--artist-id') {
      options.artistId = next();
    } else if (arg === '--artist-profile') {
      options.artistProfile = next();
    } else if (arg === '--workspace') {
      options.workspace = next();
    } else if (arg === '--out') {
      options.out = next();
    } else if (arg === '--market') {
      options.market = next().toUpperCase();
    } else if (arg === '--no-context') {
      options.writeContext = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function extractArtistId(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const uriMatch = raw.match(/^spotify:artist:([A-Za-z0-9]+)$/);
  if (uriMatch?.[1]) return uriMatch[1];
  const urlMatch = raw.match(/\/artist\/([A-Za-z0-9]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  const last = basename(raw).trim();
  return /^[A-Za-z0-9]{12,}$/.test(last) ? last : null;
}

function extractJson(body: string): unknown | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i);
  const json = fenced?.[1] ?? body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1);
  if (!json.trim()) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function readArtistProfileId(workspace: string | null): string | null {
  if (!workspace) return null;
  const doc = loadContextDoc(workspace, ARTIST_PROFILE_CONTEXT_SLUG);
  const parsed = extractJson(doc?.body ?? '');
  if (!parsed || typeof parsed !== 'object') return null;
  const spotifyProfile = (parsed as { spotifyProfile?: unknown }).spotifyProfile;
  return typeof spotifyProfile === 'string' ? extractArtistId(spotifyProfile) : null;
}

async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) {
    throw new Error(`Spotify token request failed: ${response.status} ${await response.text()}`);
  }
  const json = await response.json() as { access_token?: string };
  if (!json.access_token) throw new Error('Spotify token response did not include access_token.');
  return json.access_token;
}

async function spotifyGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Spotify API request failed for ${path}: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function spotifyGetOptional<T>(token: string, path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await spotifyGet<T>(token, path), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function bestImage(artist: SpotifyArtist): string | undefined {
  return artist.images?.find((image) => image.url)?.url;
}

function buildContextBody(snapshot: unknown): string {
  return [
    'This is the latest global Spotify snapshot. Public API snapshots include catalog/audience proxy data, not private Spotify for Artists streams/listeners.',
    '',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const clientId = process.env.SPOTIFY_CLIENT_ID?.trim();
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required. Add them in Settings > Secrets > Spotify.');
  }

  const artistId = options.artistId
    ?? extractArtistId(options.artistProfile)
    ?? extractArtistId(process.env.SPOTIFY_ARTIST_ID)
    ?? readArtistProfileId(options.workspace);
  if (!artistId) {
    throw new Error('Spotify artist ID is required. Add Artist Profile > Spotify profile, set SPOTIFY_ARTIST_ID, or pass --artist-id.');
  }

  const token = await getAccessToken(clientId, clientSecret);
  const artist = await spotifyGet<SpotifyArtist>(token, `/artists/${artistId}`);
  const topTracks = await spotifyGetOptional<{ tracks?: SpotifyTrack[] }>(
    token,
    `/artists/${artistId}/top-tracks?market=${encodeURIComponent(options.market)}`,
  );
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const snapshot = {
    version: 1,
    dataSource: 'spotify-web-api',
    snapshotDate,
    windowDays: 0,
    artist: {
      name: artist.name,
      spotifyArtistId: artist.id,
      spotifyUrl: artist.external_urls?.spotify,
      genres: artist.genres ?? [],
      imageUrl: bestImage(artist),
    },
    metrics: {
      followers: artist.followers?.total ?? 0,
      popularity: artist.popularity ?? 0,
    },
    geo: { topCities: [] },
    tracks: (topTracks.data?.tracks ?? []).map((track) => ({
      id: track.id,
      name: track.name,
      popularity: track.popularity ?? 0,
      spotifyUrl: track.external_urls?.spotify,
      album: track.album?.name,
      releaseDate: track.album?.release_date,
    })),
    playlistsDriving: [],
    sources: {},
    partial: Boolean(topTracks.error),
    errors: topTracks.error
      ? [`Top tracks unavailable: ${topTracks.error}`]
      : [],
    updatedAt: new Date().toISOString(),
  };

  const outDir = options.workspace && !isAbsolute(options.out)
    ? join(options.workspace, options.out)
    : options.out;
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${snapshotDate}-web-api.json`);
  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  let contextPath: string | null = null;
  if (options.writeContext) {
    if (!options.workspace) throw new Error('--workspace is required to write Artist HQ context.');
    const loaded = upsertContextDoc(options.workspace, {
      slug: SNAPSHOT_CONTEXT_SLUG,
      metadata: {
        name: 'Artist Spotify Snapshot',
        description: 'Latest Spotify snapshot for Artist HQ widgets and workers.',
        routing: { mode: 'broadcast' },
        enabled: true,
      },
      body: buildContextBody(snapshot),
    });
    contextPath = loaded.path;
  }

  console.log(JSON.stringify({
    status: 'spotify_public_snapshot_written',
    dataSource: 'spotify-web-api',
    path: outPath,
    contextPath,
    snapshotDate,
    artist: artist.name,
    followers: snapshot.metrics.followers,
    popularity: snapshot.metrics.popularity,
    topTrackCount: snapshot.tracks.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
