#!/usr/bin/env npx tsx
/**
 * Spotify Anomaly Watch — daily check on existing snapshots.
 *
 * Reads data/spotify/snapshots/*.json. Compares latest to up-to-3 priors.
 * Flags severe / moderate / informational anomalies. Writes alerts file.
 * Severe items also appended to data/booth/agent-inbox/artist-ceo.md.
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

type Severity = "severe" | "moderate" | "informational";

type Anomaly = {
  severity: Severity;
  kind: string;
  message: string;
};

type CliOptions = {
  snapshotsDir: string;
  alertsDir: string;
  ceoInbox: string | null;
  streamDropPct: number;
  listenerDropPct: number;
  saveRateDropPct: number;
  skipRateSpikePct: number;
  playlistMinListeners: number;
};

const DEFAULT_SNAPSHOTS_DIR = "data/spotify/snapshots";
const DEFAULT_ALERTS_DIR = "data/spotify/alerts";
const DEFAULT_CEO_INBOX = "data/booth/agent-inbox/artist-ceo.md";

function usage() {
  return `Usage:
  npx tsx skills/spotify-anomaly-watch/scripts/watch.ts [options]

Options:
  --snapshots-dir <path>           Default: ${DEFAULT_SNAPSHOTS_DIR}
  --alerts-dir <path>              Default: ${DEFAULT_ALERTS_DIR}
  --ceo-inbox <path>               Default: ${DEFAULT_CEO_INBOX} (use "" to disable)
  --stream-drop-pct <n>            Sustained stream drop threshold. Default: 30
  --listener-drop-pct <n>          Sustained listener drop threshold. Default: 30
  --save-rate-drop-pct <n>         Save rate drop threshold. Default: 20
  --skip-rate-spike-pct <n>        Skip rate spike threshold. Default: 20
  --playlist-min-listeners <n>     Playlist removals below this listener count are ignored as noise. Default: 100
  --help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    snapshotsDir: DEFAULT_SNAPSHOTS_DIR,
    alertsDir: DEFAULT_ALERTS_DIR,
    ceoInbox: DEFAULT_CEO_INBOX,
    streamDropPct: 30,
    listenerDropPct: 30,
    saveRateDropPct: 20,
    skipRateSpikePct: 20,
    playlistMinListeners: 100,
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
    else if (arg === "--alerts-dir") options.alertsDir = next();
    else if (arg === "--ceo-inbox") {
      const v = next();
      options.ceoInbox = v === "" ? null : v;
    }
    else if (arg === "--stream-drop-pct") options.streamDropPct = Number(next());
    else if (arg === "--listener-drop-pct") options.listenerDropPct = Number(next());
    else if (arg === "--save-rate-drop-pct") options.saveRateDropPct = Number(next());
    else if (arg === "--skip-rate-spike-pct") options.skipRateSpikePct = Number(next());
    else if (arg === "--playlist-min-listeners") options.playlistMinListeners = Number(next());
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ["streamDropPct", "listenerDropPct", "saveRateDropPct", "skipRateSpikePct", "playlistMinListeners"] as const) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} must be a nonnegative number.`);
    }
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

async function readSnapshot(filePath: string): Promise<Snapshot | { error: string; file: string }> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch (error) {
    return {
      file: path.basename(filePath),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pctChange(prev: number, curr: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / prev) * 100;
}

/**
 * A drop is "sustained" if it occurred between two latest snapshots AND
 * the previous-vs-prior also showed a drop in the same direction. This
 * filters single-snapshot artifacts (Spotify recalculates retroactively).
 */
function sustainedDrop(snaps: Snapshot[], pick: (s: Snapshot) => number, dropPct: number): boolean {
  if (snaps.length < 2) return false;
  const latest = pick(snaps[snaps.length - 1]);
  const prev = pick(snaps[snaps.length - 2]);
  const change1 = pctChange(prev, latest);
  if (change1 === null || change1 > -dropPct) return false;
  if (snaps.length < 3) return true; // only two snapshots — accept the single drop
  const prior = pick(snaps[snaps.length - 3]);
  const change2 = pctChange(prior, prev);
  return change2 !== null && change2 < 0; // prior step also moved down
}

function sustainedSpike(snaps: Snapshot[], pick: (s: Snapshot) => number, spikePct: number): boolean {
  if (snaps.length < 2) return false;
  const latest = pick(snaps[snaps.length - 1]);
  const prev = pick(snaps[snaps.length - 2]);
  const change1 = pctChange(prev, latest);
  if (change1 === null || change1 < spikePct) return false;
  if (snaps.length < 3) return true;
  const prior = pick(snaps[snaps.length - 3]);
  const change2 = pctChange(prior, prev);
  return change2 !== null && change2 > 0;
}

function detectAnomalies(snaps: Snapshot[], options: CliOptions): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (snaps.length === 0) return anomalies;
  const latest = snaps[snaps.length - 1];

  if (latest.partial) {
    anomalies.push({
      severity: "informational",
      kind: "partial-snapshot",
      message: `Latest snapshot is partial. Errors: ${latest.errors.join("; ") || "(unspecified)"}`,
    });
  }

  if (snaps.length < 2) {
    anomalies.push({
      severity: "informational",
      kind: "baseline",
      message: `Only one snapshot available (${latest.snapshotDate}). No comparisons yet.`,
    });
    return anomalies;
  }

  const previous = snaps[snaps.length - 2];

  // Sustained metric drops (need to look back further if available)
  if (sustainedDrop(snaps, (s) => s.metrics.streams, options.streamDropPct)) {
    const change = pctChange(previous.metrics.streams, latest.metrics.streams) ?? 0;
    anomalies.push({
      severity: "severe",
      kind: "stream-drop",
      message: `Streams dropped ${Math.abs(change).toFixed(1)}% from ${previous.snapshotDate} → ${latest.snapshotDate} (${previous.metrics.streams} → ${latest.metrics.streams}). Sustained over multiple snapshots.`,
    });
  }
  if (sustainedDrop(snaps, (s) => s.metrics.listeners, options.listenerDropPct)) {
    const change = pctChange(previous.metrics.listeners, latest.metrics.listeners) ?? 0;
    anomalies.push({
      severity: "severe",
      kind: "listener-drop",
      message: `Listeners dropped ${Math.abs(change).toFixed(1)}% (${previous.metrics.listeners} → ${latest.metrics.listeners}). Sustained.`,
    });
  }
  if (sustainedDrop(snaps, (s) => s.metrics.saveRate, options.saveRateDropPct)) {
    const change = pctChange(previous.metrics.saveRate, latest.metrics.saveRate) ?? 0;
    anomalies.push({
      severity: "moderate",
      kind: "save-rate-drop",
      message: `Save rate dropped ${Math.abs(change).toFixed(1)}% (${(previous.metrics.saveRate * 100).toFixed(2)}% → ${(latest.metrics.saveRate * 100).toFixed(2)}%). Sustained.`,
    });
  }
  if (sustainedSpike(snaps, (s) => s.metrics.skipRate, options.skipRateSpikePct)) {
    const change = pctChange(previous.metrics.skipRate, latest.metrics.skipRate) ?? 0;
    anomalies.push({
      severity: "moderate",
      kind: "skip-rate-spike",
      message: `Skip rate spiked ${change.toFixed(1)}% (${(previous.metrics.skipRate * 100).toFixed(2)}% → ${(latest.metrics.skipRate * 100).toFixed(2)}%). Sustained.`,
    });
  }

  // Playlist removals (single-snapshot is enough; playlists don't recover on their own)
  const prevPlaylistMap = new Map(previous.playlistsDriving.map((p) => [p.name, p]));
  for (const removed of previous.playlistsDriving) {
    if (removed.listeners < options.playlistMinListeners) continue;
    if (!latest.playlistsDriving.find((p) => p.name === removed.name)) {
      anomalies.push({
        severity: "severe",
        kind: "playlist-removed",
        message: `Removed from "${removed.name}" (${removed.type}, was ${removed.listeners} listeners) since ${previous.snapshotDate}. Investigate.`,
      });
    }
  }

  // Track disappearance (top track present last, missing now)
  const prevTopTracks = [...previous.tracks].sort((a, b) => b.streams - a.streams).slice(0, 3);
  for (const track of prevTopTracks) {
    if (!latest.tracks.find((t) => t.id === track.id || t.name === track.name)) {
      anomalies.push({
        severity: "moderate",
        kind: "track-disappeared",
        message: `Top track "${track.name}" not present in latest snapshot. Could be metadata change or report shift.`,
      });
    }
  }

  // Editorial dependency growth
  const editorialGrowth = (latest.sources.editorial - previous.sources.editorial) * 100;
  if (editorialGrowth > 10) {
    anomalies.push({
      severity: "informational",
      kind: "editorial-dependency-up",
      message: `Editorial source share grew ${editorialGrowth.toFixed(1)}pts (${(previous.sources.editorial * 100).toFixed(1)}% → ${(latest.sources.editorial * 100).toFixed(1)}%). Real lift, but editorial features are not durable — track for follow-through.`,
    });
  }

  return anomalies;
}

function buildAlertMarkdown(latest: Snapshot, anomalies: Anomaly[], parseErrors: Array<{ file: string; error: string }>): string {
  const lines: string[] = [];
  lines.push(`# Spotify Anomaly Alert — ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`Latest snapshot: \`${latest.snapshotDate}\``);
  lines.push("");

  if (parseErrors.length > 0) {
    lines.push("## Parse Errors");
    lines.push("");
    for (const err of parseErrors) lines.push(`- ${err.file}: ${err.error}`);
    lines.push("");
  }

  const grouped: Record<Severity, Anomaly[]> = { severe: [], moderate: [], informational: [] };
  for (const a of anomalies) grouped[a.severity].push(a);

  const sections: Array<[Severity, string]> = [
    ["severe", "## Severe — investigate this cycle"],
    ["moderate", "## Moderate — track"],
    ["informational", "## Informational"],
  ];
  for (const [severity, header] of sections) {
    if (grouped[severity].length === 0) continue;
    lines.push(header);
    lines.push("");
    for (const a of grouped[severity]) {
      lines.push(`- **${a.kind}** — ${a.message}`);
    }
    lines.push("");
  }

  if (anomalies.length === 0) {
    lines.push("No anomalies detected. System is stable in this window.");
    lines.push("");
  }

  return lines.join("\n");
}

async function appendCeoInbox(inboxPath: string, latest: Snapshot, severeAnomalies: Anomaly[]) {
  if (severeAnomalies.length === 0) return;
  await fs.mkdir(path.dirname(inboxPath), { recursive: true });
  const block: string[] = [];
  block.push(`## Spotify Anomaly Watch — ${new Date().toISOString()}`);
  block.push("");
  block.push(`Latest snapshot: \`${latest.snapshotDate}\``);
  block.push("");
  for (const a of severeAnomalies) block.push(`- **${a.kind}** — ${a.message}`);
  block.push("");

  const exists = await fs.stat(inboxPath).catch(() => null);
  if (!exists) {
    const title = path.basename(inboxPath, ".md").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    await fs.writeFile(inboxPath, `# ${title}\n\n${block.join("\n")}\n`);
    return;
  }
  const current = await fs.readFile(inboxPath, "utf8");
  const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(inboxPath, `${current}${sep}${block.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = await listSnapshotFiles(options.snapshotsDir);
  if (files.length === 0) {
    console.log(JSON.stringify({ status: "no_snapshots", snapshotsDir: options.snapshotsDir }, null, 2));
    return;
  }

  // Read up to last 4 snapshots (latest + 3 priors)
  const slice = files.slice(-4);
  const snapshots: Snapshot[] = [];
  const parseErrors: Array<{ file: string; error: string }> = [];
  for (const file of slice) {
    const result = await readSnapshot(path.join(options.snapshotsDir, file));
    if ("error" in result) parseErrors.push(result);
    else snapshots.push(result);
  }
  if (snapshots.length === 0) {
    throw new Error(`Could not parse any snapshot files. Errors: ${parseErrors.map((e) => `${e.file}: ${e.error}`).join("; ")}`);
  }

  const latest = snapshots[snapshots.length - 1];
  const anomalies = detectAnomalies(snapshots, options);

  await fs.mkdir(options.alertsDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const alertPath = path.join(options.alertsDir, `${today}.md`);
  await fs.writeFile(alertPath, buildAlertMarkdown(latest, anomalies, parseErrors));

  if (options.ceoInbox) {
    const severe = anomalies.filter((a) => a.severity === "severe");
    if (severe.length > 0) await appendCeoInbox(options.ceoInbox, latest, severe);
  }

  console.log(JSON.stringify({
    status: "watch_complete",
    alertPath,
    latestSnapshot: latest.snapshotDate,
    snapshotsCompared: snapshots.length,
    anomaliesBySeverity: {
      severe: anomalies.filter((a) => a.severity === "severe").length,
      moderate: anomalies.filter((a) => a.severity === "moderate").length,
      informational: anomalies.filter((a) => a.severity === "informational").length,
    },
    parseErrors,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
