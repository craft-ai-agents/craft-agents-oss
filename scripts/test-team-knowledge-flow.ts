#!/usr/bin/env bun
/**
 * Test script: verify team knowledge refresh → parse → inject flow.
 *
 * Prerequisites:
 *   1. `bun run scripts/test-team-knowledge-api.ts` running on port 3100
 *   2. Workspace config with teamPublicKnowledge documents pointing to localhost:3100
 *
 * Usage:
 *   bun run scripts/test-team-knowledge-flow.ts [workspace-root-path]
 *
 * Default workspace: ~/.craft-agent/workspaces/my-workspace
 */

import { join } from 'path';
import { homedir } from 'os';
import { refreshTeamPublicKnowledge, loadTeamPublicKnowledgeCache } from '../packages/shared/src/team-public-knowledge/index.ts';
import {
  formatTeamKnowledgePolicy,
  prefetchTeamKnowledge,
  formatPrefetchBlock,
} from '../packages/shared/src/agent/core/team-public-knowledge-injector.ts';

const workspaceRoot = process.argv[2] ?? join(homedir(), '.craft-agent', 'workspaces', 'my-workspace');

console.log(`Workspace: ${workspaceRoot}\n`);

// ── Step 1: Refresh ──────────────────────────────────────────────

console.log('=== Step 1: Refresh team knowledge cache ===\n');
const summary = await refreshTeamPublicKnowledge(workspaceRoot);
console.log(JSON.stringify(summary, null, 2));

if (summary.added === 0 && summary.updated === 0) {
  console.log('\n(No new changes — cache already up to date)\n');
}

// ── Step 2: Inspect cache ────────────────────────────────────────

console.log('\n=== Step 2: Cached entries ===\n');
const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
const entries = Object.values(cache.entries);
console.log(`Total entries: ${entries.length}`);
for (const entry of entries) {
  console.log(`  ${entry.id}: "${entry.title}" — ${entry.content.length} chars, hash=${entry.contentHash?.slice(0, 12)}..., stale=${entry.stale}`);
}

// ── Step 3: Trigger terms (policy XML) ────────────────────────────

console.log('\n=== Step 3: Trigger terms (policy injected into every turn) ===\n');
const policyXml = formatTeamKnowledgePolicy(workspaceRoot);
if (policyXml) {
  console.log(policyXml);
} else {
  console.log('(No policy generated — check enabled flag or cache)');
}

// ── Step 4: Prefetch (per-message matching) ──────────────────────

const testMessages = [
  '什么是 Workspace？它和 Session 有什么关系？',
  '帮我写一个函数，按照编码规范来',
  '我们团队的 Git 工作流是什么？',
  '今天天气不错',
];

for (const msg of testMessages) {
  console.log(`\n=== Step 4: Prefetch for "${msg}" ===\n`);
  const results = prefetchTeamKnowledge(workspaceRoot, msg);
  console.log(`Matched ${results.length} entry(s):`);
  for (const r of results) {
    console.log(`  - [${r.kind}] ${r.summary.slice(0, 80)}... (confidence=${r.confidence}, source=${r.source})`);
  }

  const block = formatPrefetchBlock(results);
  if (block) {
    console.log(`\n  Injected block:\n${block.slice(0, 400)}...`);
  } else {
    console.log('  (No prefetch block generated — no terms matched)');
  }
}

console.log('\nDone.');
