#!/usr/bin/env npx tsx
/**
 * Spotify Playlist Curator — apply gate.
 *
 * Validates an approved plan file. Refuses to do anything without
 * `--apply --confirm`. When confirmed, prints a Spotify apply
 * checklist for the agent to execute step by step.
 *
 * This script does NOT touch Spotify directly. The approved Spotify
 * MCP/API/OAuth tool is the actuator. This script is the gate.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

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
  plan: string;
  apply: boolean;
  confirm: boolean;
  description: string;
  publicPlaylist: boolean;
  outRecord: string | null;
};

function usage() {
  return `Usage:
  npx tsx skills/spotify-playlist-curator/scripts/apply-plan.ts --plan <path> [--apply --confirm] [options]

Required:
  --plan <path>          Path to a plan JSON file produced by build-plan.ts.

Gate (BOTH required to print the apply checklist):
  --apply                Acknowledge intent to apply.
  --confirm              Confirm explicit approval to proceed.

Without --apply --confirm, this script prints a dry-run summary only.

Options:
  --description <text>   Playlist description text. Default: theme + auto-generated.
  --public               Make the playlist public. Default: private.
  --out-record <path>    Where to write the playlist record after success.
                         Default: data/spotify/playlists/<date>-<slug>.md
  --help
`;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    plan: "",
    apply: false,
    confirm: false,
    description: "",
    publicPlaylist: false,
    outRecord: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--help" || arg === "-h") { console.log(usage()); process.exit(0); }
    else if (arg === "--plan") options.plan = next();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm") options.confirm = true;
    else if (arg === "--description") options.description = next();
    else if (arg === "--public") options.publicPlaylist = true;
    else if (arg === "--out-record") options.outRecord = next();
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.plan) throw new Error("--plan is required");
  return options;
}

async function readPlan(filePath: string): Promise<Plan> {
  const raw = await fs.readFile(filePath, "utf8");
  const plan = JSON.parse(raw) as Plan;
  if (!Array.isArray(plan.slots) || plan.slots.length === 0) {
    throw new Error("Plan has no slots. Refusing to apply an empty plan.");
  }
  for (const slot of plan.slots) {
    if (typeof slot.trackId !== "string" || !slot.trackId) {
      throw new Error(`Plan slot at position ${slot.position} has no trackId. Refusing to apply.`);
    }
  }
  return plan;
}

function summarize(plan: Plan, options: CliOptions): string {
  const lines: string[] = [];
  lines.push(`Plan: ${options.plan}`);
  lines.push(`Theme: ${plan.theme}`);
  lines.push(`Tracks: ${plan.slots.length}`);
  lines.push(`Featured artist: ${plan.ourArtistName}`);
  lines.push(`Comparable artists in mix: ${plan.comparableArtists.join(", ")}`);
  lines.push(`Visibility: ${options.publicPlaylist ? "public" : "private"}`);
  return lines.join("\n");
}

function buildApplyChecklist(plan: Plan, options: CliOptions): string {
  const description = options.description
    || `Themed adjacency playlist around: ${plan.theme}. Curated mix of ${plan.comparableArtists.slice(0, 3).join(", ")}${plan.comparableArtists.length > 3 ? " and more" : ""}.`;

  const lines: string[] = [];
  lines.push("# Spotify Apply Checklist");
  lines.push("");
  lines.push(summarize(plan, options));
  lines.push("");
  lines.push("Execute each step in order through the available Spotify MCP/API/OAuth tool on the artist's approved account.");
  lines.push("If no Spotify write tool is available, stop and return this checklist as the setup-ready payload.");
  lines.push("");
  lines.push(`## 1. Create the playlist`);
  lines.push("");
  lines.push("- Confirm the Spotify account belongs to the artist/user.");
  lines.push("- Create a new playlist.");
  lines.push(`- Set name: \`${plan.theme}\``);
  lines.push(`- Set description: \`${description}\``);
  lines.push(`- Set visibility: ${options.publicPlaylist ? "public" : "private"}`);
  lines.push("- Capture the resulting playlist URL.");
  lines.push("");
  lines.push("## 2. Add tracks in order");
  lines.push("");
  lines.push("Add each track by Spotify track URI in this exact order:");
  lines.push("");
  lines.push("| # | URI | Track | Artist |");
  lines.push("|---|---|---|---|");
  for (const slot of plan.slots) {
    const uri = `spotify:track:${slot.trackId}`;
    lines.push(`| ${slot.position} | \`${uri}\` | ${slot.trackName.replace(/\|/g, "\\|")} | ${slot.artistName.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  lines.push("## 3. Verify");
  lines.push("");
  lines.push("- Confirm track count on the playlist matches the plan.");
  lines.push("- Confirm at least one of the artist's own tracks is in the playlist.");
  lines.push("");
  lines.push("## 4. Record");
  lines.push("");
  lines.push(`Write a record file at: \`${defaultRecordPath(plan, options)}\` with playlist URL, track count, creation timestamp, and the plan path.`);
  lines.push("");
  return lines.join("\n");
}

function defaultRecordPath(plan: Plan, options: CliOptions): string {
  if (options.outRecord) return options.outRecord;
  const date = new Date().toISOString().slice(0, 10);
  const slug = plan.theme
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `data/spotify/playlists/${date}-${slug}.md`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const plan = await readPlan(options.plan);

  if (!options.apply || !options.confirm) {
    console.log("=== DRY RUN ===");
    console.log(summarize(plan, options));
    console.log("");
    console.log("Gate not satisfied. To apply this plan, re-run with both --apply and --confirm.");
    console.log("Without those flags, this script prints summary only and never touches Spotify.");
    process.exit(0);
  }

  const checklist = buildApplyChecklist(plan, options);
  const checklistPath = options.plan.replace(/\.json$/u, ".apply-checklist.md");
  await fs.writeFile(checklistPath, checklist);

  console.log(JSON.stringify({
    status: "apply_authorized",
    checklistPath,
    recordPathExpected: defaultRecordPath(plan, options),
    note: "Spotify apply checklist written. Agent now uses available Spotify tooling step by step. Script does not touch Spotify itself.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
