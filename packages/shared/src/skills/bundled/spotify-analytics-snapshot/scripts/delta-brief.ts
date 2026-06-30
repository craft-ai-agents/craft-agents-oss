#!/usr/bin/env npx tsx
/**
 * Spotify Delta Brief — compare latest two snapshots, emit a markdown brief.
 *
 * Reads `data/spotify/snapshots/*.json`, picks the latest two, computes
 * deltas, writes `data/spotify/briefs/<latest-date>.md`.
 *
 * No scraping. Pure data manipulation.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

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
  geo: { topCities: Array<{ city: string; country: string; listeners: number }> };
  tracks: Array<{ id: string; name: string; streams: number; saves: number; playlistAdds: number }>;
  playlistsDriving: Array<{ name: string; type: string; listeners: number; addedDate: string | null }>;
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
  snapshotsDir: string;
  outDir: string;
  noiseFloorPct: number;
};

const DEFAULT_SNAPSHOTS_DIR = "data/spotify/snapshots";
const DEFAULT_OUT_DIR = "data/spotify/briefs";

function usage() {
  return `Usage:
  npx tsx skills/spotify-analytics-snapshot/scripts/delta-brief.ts [options]

Options:
  --snapshots-dir <path>   Default: ${DEFAULT_SNAPSHOTS_DIR}
  --out-dir <path>         Default: ${DEFAULT_OUT_DIR}
  --noise-floor <pct>      Movements below this percent flagged as 'noise'. Default: 10
  --help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    snapshotsDir: DEFAULT_SNAPSHOTS_DIR,
    outDir: DEFAULT_OUT_DIR,
    noiseFloorPct: 10,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    else if (arg === "--snapshots-dir") options.snapshotsDir = next();
    else if (arg === "--out-dir") options.outDir = next();
    else if (arg === "--noise-floor") options.noiseFloorPct = Number(next());
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.noiseFloorPct) || options.noiseFloorPct < 0) {
    throw new Error("--noise-floor must be a nonnegative number.");
  }
  return options;
}

async function listSnapshotFiles(dir: string): Promise<string[]> {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat || !stat.isDirectory()) return [];
  const entries = await fs.readdir(dir);
  return entries
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
}

async function readSnapshot(filePath: string): Promise<Snapshot> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as Snapshot;
}

function pctChange(prev: number, curr: number): { abs: number; pct: number | null } {
  const abs = curr - prev;
  if (prev === 0) return { abs, pct: curr === 0 ? 0 : null };
  return { abs, pct: (abs / prev) * 100 };
}

function fmtPct(pct: number | null): string {
  if (pct === null) return "(from 0)";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtDelta(prev: number, curr: number, label: string): string {
  const { abs, pct } = pctChange(prev, curr);
  const sign = abs >= 0 ? "+" : "";
  return `- ${label}: ${prev} → ${curr} (${sign}${abs}, ${fmtPct(pct)})`;
}

function fmtRateDelta(prev: number, curr: number, label: string): string {
  const abs = curr - prev;
  const sign = abs >= 0 ? "+" : "";
  const pct = prev === 0 ? null : (abs / prev) * 100;
  return `- ${label}: ${(prev * 100).toFixed(2)}% → ${(curr * 100).toFixed(2)}% (${sign}${(abs * 100).toFixed(2)} pts${pct !== null ? `, ${fmtPct(pct)}` : ""})`;
}

function topMovers(prev: Snapshot, curr: Snapshot, limit = 3): Array<{ name: string; delta: number; pct: number | null }> {
  const prevMap = new Map(prev.tracks.map((t) => [t.id, t.streams]));
  const movers: Array<{ name: string; delta: number; pct: number | null }> = [];
  for (const track of curr.tracks) {
    const prevStreams = prevMap.get(track.id) ?? 0;
    const { abs, pct } = pctChange(prevStreams, track.streams);
    movers.push({ name: track.name, delta: abs, pct });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return movers.slice(0, limit);
}

function playlistDiff(prev: Snapshot, curr: Snapshot): { added: typeof curr.playlistsDriving; removed: typeof prev.playlistsDriving } {
  const prevNames = new Set(prev.playlistsDriving.map((p) => p.name));
  const currNames = new Set(curr.playlistsDriving.map((p) => p.name));
  const added = curr.playlistsDriving.filter((p) => !prevNames.has(p.name));
  const removed = prev.playlistsDriving.filter((p) => !currNames.has(p.name));
  return { added, removed };
}

function noiseTag(pct: number | null, floor: number): string {
  if (pct === null) return "";
  return Math.abs(pct) < floor ? " _(below noise floor — likely insignificant)_" : "";
}

function buildBrief(prev: Snapshot, curr: Snapshot, noiseFloorPct: number): string {
  const lines: string[] = [];
  const partialNote = curr.partial ? " (current snapshot is partial)" : "";
  lines.push(`# Spotify Delta Brief — ${curr.snapshotDate}${partialNote}`);
  lines.push("");
  lines.push(`Comparing **${prev.snapshotDate}** → **${curr.snapshotDate}** for ${curr.artist.name}.`);
  lines.push("");

  if (curr.partial && curr.errors.length > 0) {
    lines.push(`> **Partial snapshot.** Errors: ${curr.errors.join("; ")}`);
    lines.push("");
  }

  lines.push("## Aggregate Metrics");
  lines.push("");
  const streamsDelta = pctChange(prev.metrics.streams, curr.metrics.streams);
  const listenersDelta = pctChange(prev.metrics.listeners, curr.metrics.listeners);
  const followersDelta = pctChange(prev.metrics.followers, curr.metrics.followers);
  lines.push(`${fmtDelta(prev.metrics.streams, curr.metrics.streams, "Streams")}${noiseTag(streamsDelta.pct, noiseFloorPct)}`);
  lines.push(`${fmtDelta(prev.metrics.listeners, curr.metrics.listeners, "Listeners")}${noiseTag(listenersDelta.pct, noiseFloorPct)}`);
  lines.push(`${fmtDelta(prev.metrics.followers, curr.metrics.followers, "Followers")}${noiseTag(followersDelta.pct, noiseFloorPct)}`);
  lines.push(fmtRateDelta(prev.metrics.saveRate, curr.metrics.saveRate, "Save rate"));
  lines.push(fmtRateDelta(prev.metrics.skipRate, curr.metrics.skipRate, "Skip rate"));
  lines.push("");

  lines.push("## Top Track Movement");
  lines.push("");
  const movers = topMovers(prev, curr, 3);
  if (movers.length === 0) {
    lines.push("- No tracks recorded in current snapshot.");
  } else {
    for (const mover of movers) {
      const sign = mover.delta >= 0 ? "+" : "";
      lines.push(`- ${mover.name}: ${sign}${mover.delta} streams (${fmtPct(mover.pct)})`);
    }
  }
  lines.push("");

  const { added, removed } = playlistDiff(prev, curr);
  lines.push("## Playlist Changes");
  lines.push("");
  if (added.length === 0 && removed.length === 0) {
    lines.push("- No additions or removals.");
  }
  if (added.length > 0) {
    lines.push("**Added:**");
    for (const p of added) lines.push(`- ${p.name} (${p.type}) — ${p.listeners} listeners`);
  }
  if (removed.length > 0) {
    lines.push(added.length > 0 ? "" : "");
    lines.push("**Removed (anomaly — investigate):**");
    for (const p of removed) lines.push(`- ${p.name} (${p.type}) — was ${p.listeners} listeners`);
  }
  lines.push("");

  lines.push("## Source Of Streams");
  lines.push("");
  const srcDelta = (key: keyof Snapshot["sources"], label: string) => {
    const prevV = prev.sources[key];
    const currV = curr.sources[key];
    const abs = currV - prevV;
    const sign = abs >= 0 ? "+" : "";
    return `- ${label}: ${(prevV * 100).toFixed(1)}% → ${(currV * 100).toFixed(1)}% (${sign}${(abs * 100).toFixed(1)} pts)`;
  };
  lines.push(srcDelta("algorithmic", "Algorithmic"));
  lines.push(srcDelta("editorial", "Editorial"));
  lines.push(srcDelta("listenerLibrary", "Listener libraries"));
  lines.push(srcDelta("search", "Search"));
  lines.push(srcDelta("otherListeners", "Other listener playlists"));
  lines.push("");

  lines.push("## Interpretation");
  lines.push("");
  const interpretations: string[] = [];
  if (streamsDelta.pct !== null && Math.abs(streamsDelta.pct) >= noiseFloorPct) {
    interpretations.push(streamsDelta.pct > 0
      ? `Streams up ${streamsDelta.pct.toFixed(1)}%. Look at top movers to see what carried it.`
      : `Streams down ${Math.abs(streamsDelta.pct).toFixed(1)}%. Check playlist removals and source-of-streams shifts.`);
  }
  if (removed.length > 0) {
    interpretations.push(`${removed.length} playlist${removed.length === 1 ? "" : "s"} dropped. Anomaly watcher will surface this — investigate before next slate.`);
  }
  if (curr.sources.editorial - prev.sources.editorial > 0.05) {
    interpretations.push(`Editorial share grew >5pts. Real lift, but track for sustainability — editorial features are not durable.`);
  }
  if (interpretations.length === 0) {
    interpretations.push("No movement above noise floor. Stable window.");
  }
  for (const line of interpretations) lines.push(`- ${line}`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await listSnapshotFiles(options.snapshotsDir);
  if (files.length === 0) {
    throw new Error(`No snapshots found in ${options.snapshotsDir}.`);
  }

  await fs.mkdir(options.outDir, { recursive: true });

  if (files.length === 1) {
    const firstFile = files[0];
    if (!firstFile) throw new Error(`No snapshots found in ${options.snapshotsDir}.`);
    const snapshot = await readSnapshot(path.join(options.snapshotsDir, firstFile));
    const brief = `# Spotify Delta Brief — ${snapshot.snapshotDate}\n\nNo prior snapshot. Baseline captured.\n\n- Streams: ${snapshot.metrics.streams}\n- Listeners: ${snapshot.metrics.listeners}\n- Followers: ${snapshot.metrics.followers}\n- Save rate: ${(snapshot.metrics.saveRate * 100).toFixed(2)}%\n- Skip rate: ${(snapshot.metrics.skipRate * 100).toFixed(2)}%\n`;
    const briefPath = path.join(options.outDir, `${snapshot.snapshotDate}.md`);
    await fs.writeFile(briefPath, brief);
    console.log(JSON.stringify({ status: "baseline_brief", path: briefPath }, null, 2));
    return;
  }

  const latest = files[files.length - 1];
  const previous = files[files.length - 2];
  if (!latest || !previous) {
    throw new Error(`At least two snapshots are required in ${options.snapshotsDir}.`);
  }
  const prevSnapshot = await readSnapshot(path.join(options.snapshotsDir, previous));
  const currSnapshot = await readSnapshot(path.join(options.snapshotsDir, latest));

  const brief = buildBrief(prevSnapshot, currSnapshot, options.noiseFloorPct);
  const briefPath = path.join(options.outDir, `${currSnapshot.snapshotDate}.md`);
  await fs.writeFile(briefPath, brief);

  console.log(JSON.stringify({
    status: "delta_brief_written",
    path: briefPath,
    compared: { previous: prevSnapshot.snapshotDate, current: currSnapshot.snapshotDate },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
