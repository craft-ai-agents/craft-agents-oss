#!/usr/bin/env bun
// Routing DOE — vary the routing strategy (and temperature) over a fixed eval set,
// score each cell by PI = wq·quality + wl·(1/latency) + wc·(1/cost), find the best lane.
//
// Talks to the running shadow-router gateway (auth required). Keep the matrix small —
// every cell burns real tokens. Writes doe-results.jsonl (one row per cell·task) and
// prints the PI ranking. Feeds the shadow-research factory's doe-results surface.
//
//   bun run doe/run-doe.ts --strategies auto,fusion,vibeproxy/gpt-5.5 --temps 0 --out /tmp/doe-results.jsonl

interface Task { id: string; category: string; prompt: string; rubric: string }

const GW = process.env.SHADOW_ROUTER_URL ?? "http://127.0.0.1:8787";
const KEY = await resolveKey();

// Relative cost weights per lane (subscription marginal ≈ low, local = 0, metered = high).
const LANE_COST: Record<string, number> = {
  ollama: 0.0,
  "vibeproxy/claude-opus-4-8": 1.0,
  "vibeproxy/gpt-5.5": 0.8,
  "vibeproxy/gemini-3-pro-low": 0.5,
  "vibeproxy/claude-haiku-4-5-20251001": 0.2,
  fusion: 2.4, // ~3 members + synth
  auto: 0.6,
  openrouter: 0.7,
};

function laneCost(routeHeader: string, model: string): number {
  if (LANE_COST[model] != null) return LANE_COST[model];
  if (LANE_COST[routeHeader] != null) return LANE_COST[routeHeader];
  const prov = routeHeader.split("/")[0];
  return LANE_COST[prov] ?? 0.6;
}

async function resolveKey(): Promise<string> {
  if (process.env.SHADOW_ROUTER_KEY) return process.env.SHADOW_ROUTER_KEY;
  const out = Bun.spawnSync(["security", "find-generic-password", "-s", "SHADOW_ROUTER_KEY", "-w"]);
  return out.exitCode === 0 ? out.stdout.toString().trim() : "";
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Retry on empty/errored responses with backoff — a rate-limited lane must not be
// scored as quality=0 (that poisons the comparison). Only genuine empties after
// retries are marked errored and excluded from PI.
async function chat(model: string, prompt: string, temperature: number, tries = 3) {
  let last = { content: "", latency: 0, route: model, tokens: 0, ok: false };
  for (let attempt = 1; attempt <= tries; attempt++) {
    const t0 = Date.now();
    const r = await fetch(`${GW}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model, temperature, stream: false, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
    });
    const latency = Date.now() - t0;
    const route = r.headers.get("x-shadow-route") ?? model;
    const j: any = await r.json().catch(() => ({}));
    const content = j.choices?.[0]?.message?.content ?? "";
    const tokens = (j.usage?.total_tokens as number) ?? Math.ceil(content.length / 4);
    last = { content, latency, route, tokens, ok: Boolean(content) };
    if (last.ok) return last;
    await sleep(1500 * attempt); // backoff before retry
  }
  return last;
}

const JUDGE = process.env.DOE_JUDGE ?? "vibeproxy/claude-sonnet-4-6";
// Returns -1 for an unparseable/failed judge (excluded), not 0 (which would look like "bad answer").
async function judge(task: Task, answer: string): Promise<number> {
  const p = `Score this answer 0-10 against the rubric. End your reply with "Score: N".\n\nTask: ${task.prompt}\nRubric: ${task.rubric}\n\nAnswer:\n${answer}`;
  const r = await chat(JUDGE, p, 0);
  if (!r.ok) return -1;
  // Prefer an explicit "Score: N"; else take the LAST 0-10 integer (the verdict, not mid-reasoning numbers).
  const tagged = r.content.match(/score:\s*(10|[0-9])\b/i);
  if (tagged) return Number(tagged[1]);
  const all = [...r.content.matchAll(/\b(10|[0-9])\b/g)];
  return all.length ? Number(all[all.length - 1][1]) : -1;
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const strategies = arg("strategies", "auto,fusion,vibeproxy/gpt-5.5,vibeproxy/claude-opus-4-8").split(",");
const temps = arg("temps", "0").split(",").map(Number);
const outPath = arg("out", "/tmp/doe-results.jsonl");
const tasks: Task[] = (await Bun.file(new URL("./eval-set.json", import.meta.url).pathname).json()).tasks;

if (!KEY) { console.error("no SHADOW_ROUTER_KEY"); process.exit(1); }
console.log(`DOE: ${strategies.length} strategies × ${temps.length} temps × ${tasks.length} tasks = ${strategies.length * temps.length * tasks.length} cells`);

const rows: any[] = [];
for (const strategy of strategies) {
  for (const temperature of temps) {
    for (const task of tasks) {
      const gen = await chat(strategy, task.prompt, temperature);
      const quality = gen.ok ? await judge(task, gen.content) : 0;
      const cost = laneCost(gen.route, strategy) * Math.max(1, gen.tokens / 400);
      const ok = gen.ok && quality >= 0; // judge failure (quality<0) is excluded, not scored 0
      const row = {
        strategy, temperature, task: task.id, category: task.category,
        route: gen.route, latency_ms: gen.latency, tokens: gen.tokens,
        quality, cost: Number(cost.toFixed(3)), ok,
        failure: !gen.ok ? "gen" : quality < 0 ? "judge" : null,
      };
      rows.push(row);
      console.log(`  ${strategy}@${temperature} ${task.id}: ${ok ? `q=${quality}` : `SKIP(${row.failure})`} lat=${gen.latency}ms route=${gen.route}`);
      await sleep(800); // space calls to avoid self-inflicted rate limits
    }
  }
}

// PI is computed only over cells that actually generated — errored (rate-limited)
// cells are reported separately, never scored as quality 0.
const scored = rows.filter((r) => r.ok);
const errored = rows.filter((r) => !r.ok);
const maxLat = Math.max(...scored.map((r) => r.latency_ms), 1);
const maxCost = Math.max(...scored.map((r) => r.cost), 0.001);
const W = { q: 0.6, l: 0.25, c: 0.15 };
for (const r of rows) {
  r.pi = r.ok
    ? Number((W.q * (r.quality / 10) + W.l * (1 - r.latency_ms / maxLat) + W.c * (1 - r.cost / maxCost)).toFixed(4))
    : null;
}

await Bun.write(outPath, rows.map((r) => JSON.stringify({ ...r, ts: process.env.DOE_TS ?? null })).join("\n") + "\n");

// Rank strategies by mean PI over scored cells only.
const byStrat = new Map<string, number[]>();
for (const r of scored) (byStrat.get(r.strategy) ?? byStrat.set(r.strategy, []).get(r.strategy)!).push(r.pi);
const errByStrat = new Map<string, number>();
for (const r of errored) errByStrat.set(r.strategy, (errByStrat.get(r.strategy) ?? 0) + 1);
const ranking = [...byStrat.entries()]
  .map(([s, pis]) => ({ strategy: s, meanPI: Number((pis.reduce((a, b) => a + b, 0) / pis.length).toFixed(4)), n: pis.length, errors: errByStrat.get(s) ?? 0 }))
  .sort((a, b) => b.meanPI - a.meanPI);

console.log("\n=== PI ranking (higher = better; quality 0.6, latency 0.25, cost 0.15) ===");
for (const r of ranking) console.log(`  ${r.meanPI}  ${r.strategy}  (n=${r.n}${r.errors ? `, ${r.errors} errored` : ""})`);
if (errored.length) console.log(`\n${errored.length} cells errored after retries (excluded from PI): ${[...errByStrat.entries()].map(([s, n]) => `${s}×${n}`).join(", ")}`);
console.log(`\nwrote ${rows.length} rows (${scored.length} scored) → ${outPath}`);
console.log(`best: ${ranking[0]?.strategy} (PI ${ranking[0]?.meanPI})`);
