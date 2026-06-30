#!/usr/bin/env npx tsx
/**
 * Spotify Analytics Snapshot — bi-weekly capture.
 *
 * Drives Browser Harness through Spotify for Artists (read-only) to
 * capture a structured snapshot. Writes to data/spotify/snapshots/<date>.json.
 *
 * The browser scraping itself is delegated to the Browser Harness CLI, which
 * the calling agent invokes step by step per `doc/BROWSER-AGENT-SETUP.md`.
 * This script handles:
 *
 *   - argument parsing
 *   - input validation (SPOTIFY_ARTIST_ID present, browser-harness reachable)
 *   - reading a captured payload from a fixture or from stdin (--input)
 *   - shape validation
 *   - writing the snapshot file with correct schema
 *
 * Two run modes:
 *
 *   --from-fixture <path>  read JSON from a fixture file (for tests / dry runs)
 *   --from-stdin           read JSON from stdin (for piping from a harness run)
 *
 * Live scraping orchestration belongs in the agent prompt, not this script.
 * That keeps the script deterministic and testable, and the harness flow
 * explicit in markdown rather than buried in TS.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

type SnapshotInput = {
  snapshotDate?: string;
  windowDays?: number;
  artist?: { name?: string; spotifyArtistId?: string };
  metrics?: {
    streams?: number;
    listeners?: number;
    followers?: number;
    saveRate?: number;
    skipRate?: number;
  };
  geo?: {
    topCities?: Array<{ city?: string; country?: string; listeners?: number }>;
  };
  tracks?: Array<{
    id?: string;
    name?: string;
    streams?: number;
    saves?: number;
    playlistAdds?: number;
  }>;
  playlistsDriving?: Array<{
    name?: string;
    type?: string;
    listeners?: number;
    addedDate?: string;
  }>;
  sources?: {
    algorithmic?: number;
    editorial?: number;
    listenerLibrary?: number;
    search?: number;
    otherListeners?: number;
  };
  partial?: boolean;
  errors?: string[];
};

type Snapshot = {
  snapshotDate: string;
  windowDays: number;
  artist: { name: string; spotifyArtistId: string };
  metrics: {
    streams: number;
    listeners: number;
    followers: number;
    saveRate: number;
    skipRate: number;
  };
  geo: {
    topCities: Array<{ city: string; country: string; listeners: number }>;
  };
  tracks: Array<{
    id: string;
    name: string;
    streams: number;
    saves: number;
    playlistAdds: number;
  }>;
  playlistsDriving: Array<{
    name: string;
    type: "editorial" | "algorithmic" | "user" | "unknown";
    listeners: number;
    addedDate: string | null;
  }>;
  sources: {
    algorithmic: number;
    editorial: number;
    listenerLibrary: number;
    search: number;
    otherListeners: number;
  };
  partial: boolean;
  errors: string[];
};

type CliOptions = {
  out: string;
  fromFixture: string | null;
  fromStdin: boolean;
  artistId: string | null;
  artistName: string | null;
  windowDays: number;
};

const DEFAULT_OUT_DIR = "data/spotify/snapshots";
const VALID_PLAYLIST_TYPES = new Set(["editorial", "algorithmic", "user", "unknown"]);

function usage() {
  return `Usage:
  npx tsx skills/spotify-analytics-snapshot/scripts/snapshot.ts --from-fixture <path> [options]
  npx tsx skills/spotify-analytics-snapshot/scripts/snapshot.ts --from-stdin [options]

Options:
  --from-fixture <path>   Read snapshot JSON from a file (testing / dry runs).
  --from-stdin            Read snapshot JSON from stdin (live harness piping).
  --out <dir>             Output directory. Default: ${DEFAULT_OUT_DIR}
  --artist-id <id>        Override SPOTIFY_ARTIST_ID env.
  --artist-name <name>    Artist display name. Default: from input or "Unknown".
  --window-days <n>       Snapshot window in days. Default: 28 (Spotify standard).
  --help                  Show this help.

Inputs (stdin or fixture) must be JSON shaped like the doctrine snapshot schema.
Missing fields are normalized to safe defaults; the script does not invent metrics.
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    out: DEFAULT_OUT_DIR,
    fromFixture: null,
    fromStdin: false,
    artistId: null,
    artistName: null,
    windowDays: 28,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    } else if (arg === "--from-fixture") {
      options.fromFixture = next();
    } else if (arg === "--from-stdin") {
      options.fromStdin = true;
    } else if (arg === "--out") {
      options.out = next();
    } else if (arg === "--artist-id") {
      options.artistId = next();
    } else if (arg === "--artist-name") {
      options.artistName = next();
    } else if (arg === "--window-days") {
      options.windowDays = Number(next());
    } else if (arg === "--") {
      continue;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.fromFixture && !options.fromStdin) {
    throw new Error("One of --from-fixture or --from-stdin is required.");
  }
  if (options.fromFixture && options.fromStdin) {
    throw new Error("Choose exactly one of --from-fixture or --from-stdin.");
  }
  if (!Number.isInteger(options.windowDays) || options.windowDays < 1 || options.windowDays > 365) {
    throw new Error("--window-days must be an integer between 1 and 365.");
  }
  return options;
}

async function readInput(options: CliOptions): Promise<SnapshotInput> {
  if (options.fromFixture) {
    const raw = await fs.readFile(options.fromFixture, "utf8");
    return JSON.parse(raw) as SnapshotInput;
  }
  // stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new Error("No JSON received on stdin.");
  return JSON.parse(raw) as SnapshotInput;
}

function clampRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(4));
}

function nonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function nonNegativeNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Number(value.toFixed(4));
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePlaylistType(value: unknown): Snapshot["playlistsDriving"][number]["type"] {
  if (typeof value !== "string") return "unknown";
  const v = value.toLowerCase().trim();
  if (VALID_PLAYLIST_TYPES.has(v)) return v as Snapshot["playlistsDriving"][number]["type"];
  if (v === "playlist" || v === "user-playlist") return "user";
  if (v === "spotify" || v === "official") return "editorial";
  if (v === "discover-weekly" || v === "release-radar" || v === "daily-mix") return "algorithmic";
  return "unknown";
}

function normalizeSnapshot(input: SnapshotInput, options: CliOptions): Snapshot {
  const errors = Array.isArray(input.errors) ? input.errors.map(String) : [];
  const partial = Boolean(input.partial) || errors.length > 0;

  const artistId = options.artistId
    ?? input.artist?.spotifyArtistId
    ?? process.env.SPOTIFY_ARTIST_ID
    ?? "";
  if (!artistId) {
    throw new Error("SPOTIFY_ARTIST_ID is required (set env or pass --artist-id or include in input).");
  }

  const artistName = options.artistName ?? input.artist?.name ?? "Unknown Artist";
  const snapshotDate = safeString(input.snapshotDate, new Date().toISOString().slice(0, 10));

  return {
    snapshotDate,
    windowDays: typeof input.windowDays === "number" ? input.windowDays : options.windowDays,
    artist: { name: artistName, spotifyArtistId: artistId },
    metrics: {
      streams: nonNegativeInt(input.metrics?.streams),
      listeners: nonNegativeInt(input.metrics?.listeners),
      followers: nonNegativeInt(input.metrics?.followers),
      saveRate: clampRate(input.metrics?.saveRate),
      skipRate: clampRate(input.metrics?.skipRate),
    },
    geo: {
      topCities: (input.geo?.topCities ?? [])
        .filter((city) => city && typeof city.city === "string")
        .map((city) => ({
          city: safeString(city.city, "Unknown"),
          country: safeString(city.country, ""),
          listeners: nonNegativeInt(city.listeners),
        })),
    },
    tracks: (input.tracks ?? [])
      .filter((track) => track && typeof track.name === "string")
      .map((track) => ({
        id: safeString(track.id, safeString(track.name, "")),
        name: safeString(track.name, "Unknown"),
        streams: nonNegativeInt(track.streams),
        saves: nonNegativeInt(track.saves),
        playlistAdds: nonNegativeInt(track.playlistAdds),
      })),
    playlistsDriving: (input.playlistsDriving ?? [])
      .filter((p) => p && typeof p.name === "string")
      .map((p) => ({
        name: safeString(p.name, "Unknown"),
        type: normalizePlaylistType(p.type),
        listeners: nonNegativeInt(p.listeners),
        addedDate: typeof p.addedDate === "string" && p.addedDate.trim() ? p.addedDate : null,
      })),
    sources: {
      algorithmic: clampRate(input.sources?.algorithmic),
      editorial: clampRate(input.sources?.editorial),
      listenerLibrary: clampRate(input.sources?.listenerLibrary),
      search: clampRate(input.sources?.search),
      otherListeners: clampRate(input.sources?.otherListeners),
    },
    partial,
    errors,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = await readInput(options);
  const snapshot = normalizeSnapshot(input, options);

  await fs.mkdir(options.out, { recursive: true });
  const filename = `${snapshot.snapshotDate}.json`;
  const fullPath = path.join(options.out, filename);

  if (await fs.stat(fullPath).catch(() => null)) {
    throw new Error(`Refusing to overwrite existing snapshot: ${fullPath}. Snapshots are append-only.`);
  }

  await fs.writeFile(fullPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(JSON.stringify({
    status: "snapshot_written",
    path: fullPath,
    snapshotDate: snapshot.snapshotDate,
    partial: snapshot.partial,
    errors: snapshot.errors,
    metrics: snapshot.metrics,
    trackCount: snapshot.tracks.length,
    playlistCount: snapshot.playlistsDriving.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
