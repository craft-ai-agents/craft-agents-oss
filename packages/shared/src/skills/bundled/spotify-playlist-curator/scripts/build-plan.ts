#!/usr/bin/env bun
/**
 * Spotify Playlist Curator — build a sandwich-pattern playlist plan.
 *
 * Read-only. Takes user-curated comparable-tracks + our-tracks JSON files,
 * outputs a deterministic playlist plan (JSON + readable markdown).
 *
 * No Spotify writes. No fabrication of track IDs.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

type ComparableTrack = {
  id: string;
  name: string;
  durationMs?: number;
  popularity?: number;
};

type ComparableArtist = {
  spotifyArtistId: string;
  artistName: string;
  vibe?: string;
  tracks: ComparableTrack[];
};

type OurTrack = {
  id: string;
  name: string;
  durationMs?: number;
  preferredFeatureWeight?: number;
};

type ComparableTracksFile = { comparableTracks: ComparableArtist[] };
type OurTracksFile = { ourTracks: OurTrack[] };

type PlanSlot = {
  position: number;
  kind: "ours" | "comparable";
  trackId: string;
  trackName: string;
  artistName: string;
  rationale: string;
};

type Plan = {
  generatedAt: string;
  theme: string;
  targetLength: number;
  ourRatio: number;
  ourArtistName: string;
  comparableArtists: string[];
  slots: PlanSlot[];
  warnings: string[];
};

type CliOptions = {
  comparableTracks: string;
  ourTracks: string;
  theme: string;
  targetLength: number;
  ourRatio: number;
  out: string;
  outMd: string | null;
  ourArtistName: string;
  seed: number;
};

function usage() {
  return `Usage:
	  bun packages/shared/src/skills/bundled/spotify-playlist-curator/scripts/build-plan.ts --comparable-tracks <path> --our-tracks <path> --theme "<theme>" [options]

Options:
  --comparable-tracks <path>    JSON file with comparable artists' top tracks.
  --our-tracks <path>           JSON file with the artist's own tracks.
  --theme <text>                Playlist theme/title. Themed adjacency only.
  --target-length <n>           Target playlist length. Default: 28
  --our-ratio <0.0-0.5>         Fraction of slots filled by our tracks. Default: 0.20
  --our-artist-name <name>      Artist display name. Default: "Our Artist"
  --out <path>                  Plan JSON output path. Default: data/spotify/playlist-plans/<date>-<slug>.json
  --out-md <path>               Optional readable markdown output path. Default: same as --out with .md extension.
  --seed <n>                    Deterministic shuffle seed. Default: 42
  --help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    comparableTracks: "",
    ourTracks: "",
    theme: "",
    targetLength: 28,
    ourRatio: 0.20,
    out: "",
    outMd: null,
    ourArtistName: "Our Artist",
    seed: 42,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    else if (arg === "--comparable-tracks") options.comparableTracks = next();
    else if (arg === "--our-tracks") options.ourTracks = next();
    else if (arg === "--theme") options.theme = next();
    else if (arg === "--target-length") options.targetLength = Number(next());
    else if (arg === "--our-ratio") options.ourRatio = Number(next());
    else if (arg === "--out") options.out = next();
    else if (arg === "--out-md") options.outMd = next();
    else if (arg === "--our-artist-name") options.ourArtistName = next();
    else if (arg === "--seed") options.seed = Number(next());
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.comparableTracks) throw new Error("--comparable-tracks is required");
  if (!options.ourTracks) throw new Error("--our-tracks is required");
  if (!options.theme.trim()) throw new Error("--theme is required");
  if (!Number.isInteger(options.targetLength) || options.targetLength < 8 || options.targetLength > 60) {
    throw new Error("--target-length must be an integer between 8 and 60");
  }
  if (!Number.isFinite(options.ourRatio) || options.ourRatio < 0.05 || options.ourRatio > 0.5) {
    throw new Error("--our-ratio must be between 0.05 and 0.5 (recommended 0.15-0.25)");
  }

  // Doctrine: ban naming a playlist after another artist's song
  const lowerTheme = options.theme.toLowerCase();
  const bannedPatterns = ["radio", "songs like ", "if you like ", "more like "];
  for (const pat of bannedPatterns) {
    if (lowerTheme.includes(pat)) {
      throw new Error(`Theme "${options.theme}" looks like an artist-bait pattern (matched: "${pat.trim()}"). Doctrine: themed adjacency only — name by mood, scene, or vibe.`);
    }
  }

  if (!options.out) {
    const date = new Date().toISOString().slice(0, 10);
    const slug = options.theme
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40);
    options.out = `data/spotify/playlist-plans/${date}-${slug}.json`;
  }
  if (!options.outMd) {
    options.outMd = options.out.replace(/\.json$/u, ".md");
    if (!options.outMd.endsWith(".md")) options.outMd = `${options.out}.md`;
  }
  return options;
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

/** Mulberry32 — small deterministic PRNG so plans reproduce given the same seed. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const current = arr[i];
    const swap = arr[j];
    if (current === undefined || swap === undefined) continue;
    arr[i] = swap;
    arr[j] = current;
  }
  return arr;
}

function pickOurFeaturePositions(targetLength: number, ourCount: number): number[] {
  // Distribute our-tracks evenly through the playlist with slight jitter
  // toward the front to ensure listeners discover them before bouncing.
  if (ourCount === 0) return [];
  const segment = targetLength / ourCount;
  const positions: number[] = [];
  for (let i = 0; i < ourCount; i += 1) {
    const center = Math.round(segment * i + segment * 0.5);
    // Slight bias forward (subtract 1 for first half, leave latter half)
    const adj = i < ourCount / 2 ? Math.max(2, center - 1) : center;
    positions.push(Math.min(targetLength - 1, adj));
  }
  // Ensure unique and sorted
  return [...new Set(positions)].sort((a, b) => a - b);
}

function buildPlan(
  comparable: ComparableArtist[],
  our: OurTrack[],
  options: CliOptions,
): Plan {
  const warnings: string[] = [];

  if (comparable.length < 3) {
    throw new Error(`At least 3 comparable artists with tracks are required. Received ${comparable.length}.`);
  }
  if (our.length === 0) {
    throw new Error("No our-tracks provided. Cannot build playlist plan with zero of the artist's tracks.");
  }

  const ourCount = Math.max(1, Math.round(options.targetLength * options.ourRatio));
  const comparableCount = options.targetLength - ourCount;

  // Sort our tracks by preferredFeatureWeight desc (default 1.0)
  const ourSorted = [...our].sort(
    (a, b) => (b.preferredFeatureWeight ?? 1.0) - (a.preferredFeatureWeight ?? 1.0),
  );
  const ourPicks: OurTrack[] = [];
  for (let i = 0; i < ourCount; i += 1) {
    const pick = ourSorted[i % ourSorted.length];
    if (!pick) throw new Error("No our-tracks provided. Cannot build playlist plan with zero of the artist's tracks.");
    ourPicks.push(pick);
  }
  if (ourCount > our.length) {
    warnings.push(`Requested ${ourCount} our-track slots but only ${our.length} unique tracks supplied — some will repeat.`);
  }

  // Build a flat pool of comparable tracks tagged by artist, shuffled deterministically.
  const rng = makeRng(options.seed);
  type ComparableEntry = { track: ComparableTrack; artistName: string };
  const comparablePool: ComparableEntry[] = [];
  for (const artist of comparable) {
    for (const track of artist.tracks) {
      comparablePool.push({ track, artistName: artist.artistName });
    }
  }
  if (comparablePool.length === 0) {
    throw new Error("No comparable tracks provided. Cannot build playlist plan with zero comparable tracks.");
  }
  if (comparablePool.length < comparableCount) {
    warnings.push(`Only ${comparablePool.length} comparable tracks available but ${comparableCount} slots needed — some will repeat.`);
  }
  shuffleInPlace(comparablePool, rng);

  // Take comparableCount tracks but try not to repeat the same artist back-to-back.
  const comparableSequence: ComparableEntry[] = [];
  const usedTrackIds = new Set<string>();
  let cursor = 0;
  let lastArtist: string | null = null;
  let attempts = 0;
  while (comparableSequence.length < comparableCount) {
    if (attempts > comparablePool.length * 3) {
      // Fallback: relax the no-repeat-artist constraint
      const next = comparablePool[cursor % comparablePool.length];
      if (!next) throw new Error("No comparable tracks provided. Cannot build playlist plan with zero comparable tracks.");
      comparableSequence.push(next);
      cursor += 1;
      lastArtist = next.artistName;
      attempts = 0;
      continue;
    }
    const candidate = comparablePool[cursor % comparablePool.length];
    if (!candidate) throw new Error("No comparable tracks provided. Cannot build playlist plan with zero comparable tracks.");
    cursor += 1;
    attempts += 1;
    if (candidate.artistName === lastArtist) continue;
    if (usedTrackIds.has(candidate.track.id) && comparablePool.length > comparableCount) continue;
    comparableSequence.push(candidate);
    usedTrackIds.add(candidate.track.id);
    lastArtist = candidate.artistName;
    attempts = 0;
  }

  // Pick our-track feature positions
  const ourPositions = pickOurFeaturePositions(options.targetLength, ourCount);
  const ourPositionSet = new Set(ourPositions);

  // Assemble the slots
  const slots: PlanSlot[] = [];
  let comparableIdx = 0;
  let ourIdx = 0;
  for (let pos = 0; pos < options.targetLength; pos += 1) {
    if (ourPositionSet.has(pos) && ourIdx < ourPicks.length) {
      const track = ourPicks[ourIdx];
      if (!track) throw new Error("Unable to place our-track slot because no selected track exists.");
      ourIdx += 1;
      slots.push({
        position: pos + 1,
        kind: "ours",
        trackId: track.id,
        trackName: track.name,
        artistName: options.ourArtistName,
        rationale: `Feature slot ${ourIdx} of ${ourCount}. Distributed evenly through the playlist for organic discovery.`,
      });
    } else {
      const entry = comparableSequence[comparableIdx % comparableSequence.length];
      if (!entry) throw new Error("Unable to place comparable slot because no selected track exists.");
      comparableIdx += 1;
      slots.push({
        position: pos + 1,
        kind: "comparable",
        trackId: entry.track.id,
        trackName: entry.track.name,
        artistName: entry.artistName,
        rationale: `Comparable adjacency. Sets the vibe and gives listeners reason to keep playing.`,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    theme: options.theme,
    targetLength: options.targetLength,
    ourRatio: options.ourRatio,
    ourArtistName: options.ourArtistName,
    comparableArtists: comparable.map((a) => a.artistName),
    slots,
    warnings,
  };
}

function buildMarkdown(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Playlist Plan — ${plan.theme}`);
  lines.push("");
  lines.push(`Generated: ${plan.generatedAt}`);
  lines.push(`Target length: ${plan.targetLength} tracks (${Math.round(plan.ourRatio * 100)}% feature)`);
  lines.push(`Featured artist: **${plan.ourArtistName}**`);
  lines.push(`Comparable artists in mix: ${plan.comparableArtists.join(", ") || "(none)"}`);
  lines.push("");

  if (plan.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of plan.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  lines.push("## Track Order");
  lines.push("");
  lines.push("| # | Track | Artist | Slot |");
  lines.push("|---|---|---|---|");
  for (const slot of plan.slots) {
    const slotLabel = slot.kind === "ours" ? "**FEATURE**" : "comparable";
    lines.push(`| ${slot.position} | ${slot.trackName.replace(/\|/g, "\\|")} | ${slot.artistName.replace(/\|/g, "\\|")} | ${slotLabel} |`);
  }
  lines.push("");

  lines.push("## Approval");
  lines.push("");
  lines.push("Review the order above. If approved, run:");
  lines.push("");
  lines.push("```sh");
  lines.push(`bun packages/shared/src/skills/bundled/spotify-playlist-curator/scripts/apply-plan.ts --plan <plan.json> --apply --confirm`);
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const comparableFile = await readJson<ComparableTracksFile>(options.comparableTracks);
  const ourFile = await readJson<OurTracksFile>(options.ourTracks);

  const comparable = (comparableFile.comparableTracks ?? []).filter(
    (a) => a && Array.isArray(a.tracks) && a.tracks.length > 0,
  );
  const our = (ourFile.ourTracks ?? []).filter((t) => t && typeof t.id === "string");

  const plan = buildPlan(comparable, our, options);

  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, `${JSON.stringify(plan, null, 2)}\n`);

  if (options.outMd) {
    await fs.mkdir(path.dirname(options.outMd), { recursive: true });
    await fs.writeFile(options.outMd, buildMarkdown(plan));
  }

  console.log(JSON.stringify({
    status: "plan_written",
    plan: options.out,
    markdown: options.outMd,
    slots: plan.slots.length,
    ourSlots: plan.slots.filter((s) => s.kind === "ours").length,
    comparableSlots: plan.slots.filter((s) => s.kind === "comparable").length,
    warnings: plan.warnings,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
