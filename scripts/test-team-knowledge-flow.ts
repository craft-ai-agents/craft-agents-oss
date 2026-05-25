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
import { parseMarkdownEntries } from '../packages/shared/src/markdown-entry-parser/index.ts';
import {
  formatTeamKnowledgePolicy,
  prefetchTeamKnowledge,
  formatPrefetchBlock,
} from '../packages/shared/src/agent/core/team-public-knowledge-injector.ts';

const workspaceRoot = process.argv[2] ?? join(homedir(), '.craft-agent', 'workspaces', 'my-workspace');
const expectedDocumentIds = ['terminology', 'common-knowledge', 'notices', 'constraints'];
const expectedTerms = ['花豹', '天眼', 'owl', '受托', '乐高'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(haystack: string, needle: string, context: string): void {
  assert(haystack.includes(needle), `${context}: expected to include ${needle}`);
}

function assertEqualArray<T>(actual: T[], expected: T[], message: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

console.log(`Workspace: ${workspaceRoot}\n`);

// ── Step 1: Refresh ──────────────────────────────────────────────

console.log('=== Step 1: Refresh team knowledge cache ===\n');
const summary = await refreshTeamPublicKnowledge(workspaceRoot);
console.log(JSON.stringify(summary, null, 2));

assert(summary.stale === 0, `Refresh should not leave stale documents, got ${summary.stale}`);
assert(summary.conflicts === 0, `Refresh should not have duplicate document conflicts, got ${summary.conflicts}`);

// ── Step 2: Inspect cache ────────────────────────────────────────

console.log('\n=== Step 2: Cached entries ===\n');
const cache = loadTeamPublicKnowledgeCache(workspaceRoot);
const entries = Object.values(cache.entries);
console.log(`Total entries: ${entries.length}`);
for (const entry of entries) {
  console.log(`  ${entry.id}: "${entry.title}" — ${entry.content.length} chars, hash=${entry.contentHash?.slice(0, 12)}..., stale=${entry.stale}`);
}

assert(entries.length === 4, `Expected 4 cached documents, got ${entries.length}`);
assertEqualArray(entries.map(entry => entry.id).sort(), [...expectedDocumentIds].sort(), 'Cached document ids should match');

const entriesById = new Map(entries.map(entry => [entry.id, entry]));
for (const id of expectedDocumentIds) {
  const entry = entriesById.get(id);
  assert(entry, `Missing cached document ${id}`);
  assert(!entry.stale, `Document ${id} should not be stale`);
}

const parsed = entries.flatMap(entry => parseMarkdownEntries(entry.content, {
  sourceDocId: entry.id,
  sourceTitle: entry.title,
  priority: entry.priority,
  updatedAt: entry.updatedAt,
}));
const parsedByDoc = new Map(expectedDocumentIds.map(id => [
  id,
  parsed.filter(entry => entry.sourceDocId === id),
]));
const terminologyEntries = parsedByDoc.get('terminology')!;

assert(terminologyEntries.length === 5, 'terminology should contain 5 term entries');
assert(terminologyEntries.every(entry => entry.kind === 'term'), 'terminology entries should all be term kind');
assertEqualArray(terminologyEntries.map(entry => entry.term), expectedTerms, 'terminology terms should match');
assert(parsedByDoc.get('common-knowledge')!.every(entry => entry.kind === 'knowledge'), 'common-knowledge entries should all be knowledge kind');
assert(parsedByDoc.get('notices')!.every(entry => entry.kind === 'notice'), 'notices entries should all be notice kind');
assert(parsedByDoc.get('constraints')!.every(entry => entry.kind === 'rule'), 'constraints entries should all be rule kind');

// ── Step 3: Trigger terms (policy XML) ────────────────────────────

console.log('\n=== Step 3: Trigger terms (policy injected into every turn) ===\n');
const policyXml = formatTeamKnowledgePolicy(workspaceRoot);
if (policyXml) {
  console.log(policyXml);
} else {
  console.log('(No policy generated — check enabled flag or cache)');
}

assert(policyXml, 'Expected team knowledge policy XML');
for (const term of expectedTerms) {
  assertIncludes(policyXml, `"${term}" (term)`, 'policy trigger terms');
}
for (const nonTrigger of ['灰度时间', '规范着装', '性能问题', '实事求是']) {
  assert(!policyXml.includes(`"${nonTrigger}"`), `Non-term entry ${nonTrigger} should not appear in trigger terms`);
}

// ── Step 4: Prefetch (per-message matching) ──────────────────────

const testMessages = [
  '花豹是什么系统？',
  '今天需要规范着装吗？',
  '手机银行灰度时间是什么时候？',
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

const huaBaoResults = prefetchTeamKnowledge(workspaceRoot, '花豹是什么系统？');
assert(huaBaoResults.some(result => result.kind === 'term' && result.summary.includes('前端性能监控系统')), '花豹 message should prefetch the terminology term entry');

const noticeResults = prefetchTeamKnowledge(workspaceRoot, '今天需要规范着装吗？');
assert(noticeResults.some(result => result.kind === 'notice' && result.summary.includes('规范着装')), '规范着装 message should prefetch the notice entry');

const knowledgeResults = prefetchTeamKnowledge(workspaceRoot, '手机银行灰度时间是什么时候？');
assert(knowledgeResults.some(result => result.kind === 'knowledge' && result.summary.includes('手机银行灰度')), '手机银行灰度时间 message should prefetch the knowledge entry');

const emptyResults = prefetchTeamKnowledge(workspaceRoot, '今天天气不错');
assert(emptyResults.length === 0, 'Unrelated message should not prefetch entries');

console.log('\nDone.');
